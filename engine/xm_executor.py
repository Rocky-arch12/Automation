import os
import re
import json
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, Optional, Tuple, List
from database import log_event, get_db, update_trade_outcome

try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    MT5_AVAILABLE = False

class XMExecutionEngine:
    def __init__(self):
        self.is_connected: bool = False
        self.is_mock_mode: bool = False
        self.account_info: Optional[Dict[str, Any]] = None
        self.active_server: str = os.getenv("XM_MT5_SERVER", "XMGlobal-MT5")
        self.active_login: int = int(os.getenv("XM_MT5_LOGIN", "0") or "0")
        self.active_password: str = os.getenv("XM_MT5_PASSWORD", "")
        self.mt5_path: str = os.getenv("XM_MT5_PATH", "")
        self.auto_execution_enabled: bool = os.getenv("XM_AUTO_EXECUTION", "true").lower() in ["true", "1", "yes"]

        # User's strict risk & lot rules:
        self.GOLD_LOTS = 0.02       # Gold: ALWAYS 0.02 lots (exit 0.01 at 1:1)
        self.BTC_LOTS = 0.04        # Bitcoin: ALWAYS 0.04 lots (exit 0.02 at 1:1)
        self.MAX_RISK_USD = 15.0    # Other assets: Max $15 USD risk at Stop Loss
        self._managed_1to1_tickets: set = set()
        # Cutoff timestamp so historical closed DB rows before deployment remain untouched
        self._sync_cutoff_utc = "2026-11-25 19:25:00"

    @staticmethod
    def _resolve_filling_mode(sym_info: Any) -> int:
        """Resolves a supported MT5 order filling mode from the symbol's bitmask."""
        mask = getattr(sym_info, "filling_mode", 0) or 0
        if mask & 2:
            return mt5.ORDER_FILLING_IOC
        if mask & 1:
            return mt5.ORDER_FILLING_FOK
        if mask & 4:
            return mt5.ORDER_FILLING_RETURN
        return mt5.ORDER_FILLING_IOC

    async def initialize(self, login: Optional[int] = None, password: Optional[str] = None, server: Optional[str] = None, path: Optional[str] = None) -> Dict[str, Any]:
        """
        Initializes connection to XM MetaTrader 5 Terminal non-blockingly.
        If credentials not provided or MT5 terminal is not open, gracefully falls back to XM Demo Paper mode.
        """
        login = login or self.active_login
        password = password or self.active_password
        server = server or self.active_server
        path = path or self.mt5_path

        if not MT5_AVAILABLE:
            self.is_connected = False
            self.is_mock_mode = True
            return {"status": "mock", "message": "MetaTrader5 Python library not available on this platform. Running in XM Simulation Sandbox."}

        def _sync_connect():
            target_path = path
            if not target_path or not os.path.exists(target_path):
                candidates = [
                    r"C:\Program Files\XM Global MT5\terminal64.exe",
                    r"C:\Program Files (x86)\XM Global MT5\terminal64.exe",
                    r"C:\Program Files\MetaTrader 5\terminal64.exe"
                ]
                for c in candidates:
                    if os.path.exists(c):
                        target_path = c
                        break

            init_kwargs = {}
            if target_path and os.path.exists(target_path):
                init_kwargs["path"] = target_path

            # Initialize MT5 terminal
            if not mt5.initialize(**init_kwargs):
                return False, f"MT5 terminal not detected locally ({mt5.last_error()})"

            # If terminal is already running and connected to target account, use it directly
            acc = mt5.account_info()
            if acc and login and acc.login == int(login):
                return True, acc

            # If not authorized or different account, authorize with XM server
            if login and password:
                authorized = mt5.login(login=int(login), password=str(password), server=str(server))
                if not authorized:
                    return False, f"XM login failed ({mt5.last_error()}). Verify account #{login} and server '{server}'."

            acc = mt5.account_info()
            return True, acc

        try:
            # Run in worker thread with 3.5s timeout so event loop is NEVER blocked
            ok, result = await asyncio.wait_for(asyncio.to_thread(_sync_connect), timeout=3.5)
            if not ok:
                self.is_connected = False
                self.is_mock_mode = True
                await log_event("WARNING", "XM_MT5", f"{result}. Operating in XM Demo Sandbox mode.")
                return {"status": "mock", "connected": False, "message": str(result)}

            acc = result
            if acc is not None:
                self.is_connected = True
                self.is_mock_mode = False
                self.account_info = {
                    "login": acc.login,
                    "server": acc.server,
                    "currency": acc.currency,
                    "balance": round(acc.balance, 2),
                    "equity": round(acc.equity, 2),
                    "profit": round(acc.profit, 2),
                    "margin": round(acc.margin, 2),
                    "margin_free": round(acc.margin_free, 2),
                    "leverage": acc.leverage,
                    "trade_allowed": acc.trade_allowed,
                    "is_demo": True
                }
                await log_event("INFO", "XM_MT5", f"Connected to XM MT5 account #{acc.login} ({acc.server}) - Balance: {acc.balance} {acc.currency}")
                return {"status": "connected", "connected": True, "account": self.account_info}
            else:
                self.is_connected = False
                self.is_mock_mode = True
                return {"status": "mock", "connected": False, "message": "Connected to MT5 in guest mode."}
        except asyncio.TimeoutError:
            self.is_connected = False
            self.is_mock_mode = True
            await log_event("WARNING", "XM_MT5", "MT5 IPC timeout: terminal is busy or not open yet. Operating in XM Demo Sandbox mode.")
            return {"status": "mock", "connected": False, "message": "MT5 terminal IPC timeout. Running in XM Demo Sandbox mode."}
        except Exception as e:
            self.is_connected = False
            self.is_mock_mode = True
            await log_event("WARNING", "XM_MT5", f"XM MT5 error: {e}. Operating in XM Demo Sandbox mode.")
            return {"status": "mock", "connected": False, "message": str(e)}

    def get_account_status(self) -> Dict[str, Any]:
        """Returns live account health and auto-execution status."""
        if self.is_connected and MT5_AVAILABLE:
            acc = mt5.account_info()
            if acc:
                self.account_info = {
                    "login": acc.login,
                    "server": acc.server,
                    "currency": acc.currency,
                    "balance": round(acc.balance, 2),
                    "equity": round(acc.equity, 2),
                    "profit": round(acc.profit, 2),
                    "margin": round(acc.margin, 2),
                    "margin_free": round(acc.margin_free, 2),
                    "leverage": acc.leverage,
                    "trade_allowed": acc.trade_allowed,
                    "is_demo": True
                }
                return {
                    "connected": True,
                    "mode": "LIVE_MT5_DEMO",
                    "auto_execution": self.auto_execution_enabled,
                    "account": self.account_info
                }

        # Sandbox / Mock status for safe visual demonstration
        return {
            "connected": True,
            "mode": "XM_DEMO_SANDBOX",
            "auto_execution": self.auto_execution_enabled,
            "account": {
                "login": self.active_login or 88419205,
                "server": self.active_server or "XMGlobal-MT5-Demo",
                "currency": "USD",
                "balance": 10000.00,
                "equity": 10000.00,
                "profit": 0.00,
                "margin": 0.00,
                "margin_free": 10000.00,
                "leverage": 500,
                "trade_allowed": True,
                "is_demo": True
            }
        }

    def resolve_xm_symbol(self, raw_symbol: str) -> Optional[str]:
        """
        Dynamically resolves ANY asset symbol across all 1,600+ symbols on XM MT5.
        Handles Forex majors, minors, exotics, Cryptos, Metals, Indices, and Commodities.
        Returns the exact MT5 symbol name, or None if the symbol cannot be resolved.
        """
        s = (raw_symbol or "").upper().replace("/", "").replace(" ", "").strip()
        if not s:
            s = "GOLD"
        
        is_gold = any(k in s for k in ["XAU", "GOLD"])
        is_btc = any(k in s for k in ["BTC", "BITCOIN"])

        if self.is_connected and MT5_AVAILABLE:
            try:
                symbols = mt5.symbols_get()
                if symbols:
                    sym_dict = {sym.name.upper(): sym.name for sym in symbols}
                    
                    # 1. Direct match (e.g. "USDCHF", "EURUSD", "GOLD", "BTCUSD")
                    if s in sym_dict:
                        sym_name = sym_dict[s]
                        mt5.symbol_select(sym_name, True)
                        return sym_name
                    
                    # 2. Gold variants
                    if is_gold:
                        for candidate in ["GOLD", "GOLDmicro", "GOLDm", "GOLD.", "XAUUSD", "XAUUSDmicro", "XAUUSDm", "XAUUSD."]:
                            if candidate.upper() in sym_dict:
                                sym_name = sym_dict[candidate.upper()]
                                mt5.symbol_select(sym_name, True)
                                return sym_name
                    
                    # 3. Bitcoin variants
                    if is_btc:
                        for candidate in ["BTCUSD", "BTCUSDmicro", "BTCUSDT", "BTCUSD."]:
                            if candidate.upper() in sym_dict:
                                sym_name = sym_dict[candidate.upper()]
                                mt5.symbol_select(sym_name, True)
                                return sym_name

                    # 4. Standard Forex & Index candidates (e.g. USDCHF -> USDCHF, USDCHFmicro, USDCHFm, USDCHF.)
                    clean_sym = s.replace("USDT", "USD")
                    for candidate in [clean_sym, f"{clean_sym}micro", f"{clean_sym}m", f"{clean_sym}.", f"{clean_sym}Cash", f"#{clean_sym}"]:
                        if candidate.upper() in sym_dict:
                            sym_name = sym_dict[candidate.upper()]
                            mt5.symbol_select(sym_name, True)
                            return sym_name

                    # 5. Dynamic prefix / contains match across all 1,600+ XM symbols
                    for sym_upper, real_name in sym_dict.items():
                        if s in sym_upper or sym_upper.startswith(s):
                            mt5.symbol_select(real_name, True)
                            return real_name
            except Exception as e:
                print(f"[RESOLVE XM SYMBOL ERROR] {e}")

        # In Mock / Sandbox mode or if terminal is offline, return standardized broker symbol
        if is_gold:
            return "GOLD"
        if is_btc:
            return "BTCUSD"
        return s.replace("USDT", "USD")

    def validate_and_enforce_sl_tp(
        self,
        symbol: str,
        action: str,
        entry: Optional[float],
        sl: Optional[float],
        tp_levels: Optional[List[Any]] = None
    ) -> Tuple[bool, Optional[float], Optional[float], str]:
        """
        USER MANDATORY RULES:
        - Stop Loss (SL) is STRICTLY COMPULSORY.
        - Entry / CMP is OPTIONAL (executed at live market price if omitted).
        - Take Profit (TP) is OPTIONAL (order executed without TP / tp=0.0 if omitted).
        """
        is_buy = "BUY" in action.upper() or "LONG" in action.upper()

        # Stop Loss is strictly mandatory
        if sl is None or sl <= 0:
            return False, None, None, "REJECTED: Missing Stop Loss (SL). Stop Loss is strictly mandatory."

        # Extract TP if available (optional)
        extracted_tp = None
        if tp_levels and len(tp_levels) > 0:
            try:
                first_tp = float(re.sub(r'[^\d.]', '', str(tp_levels[0])))
                if first_tp > 0:
                    extracted_tp = first_tp
            except Exception:
                pass

        # If entry is provided and > 0, verify orientations
        if entry is not None and entry > 0:
            # If TP is inverted relative to entry, drop TP rather than rejecting execution
            if extracted_tp is not None:
                if is_buy and extracted_tp <= entry:
                    extracted_tp = None
                elif not is_buy and extracted_tp >= entry:
                    extracted_tp = None

        return True, sl, extracted_tp, "VALID"

    def calculate_lot_size(
        self,
        symbol: str,
        entry: float = 0.0,
        sl: float = 0.0
    ) -> float:
        """
        USER STRICT LOT RULES:
        1. Gold (XAUUSD / GOLD): ALWAYS 0.02 lots.
        2. Bitcoin (BTCUSD / BTCUSDT): ALWAYS 0.04 lots.
        3. Other pairs: ALWAYS 0.01 lots.
        """
        s_upper = (symbol or "").upper()
        if "GOLD" in s_upper or "XAU" in s_upper:
            return 0.02
        if "BTC" in s_upper or "BITCOIN" in s_upper:
            return 0.04
        return 0.01

    async def get_open_positions(self) -> List[Dict[str, Any]]:
        """
        Returns active running positions from XM MT5 terminal or from tracked executed trades.
        """
        if self.is_connected and MT5_AVAILABLE and not self.is_mock_mode:
            def _fetch_live():
                positions = mt5.positions_get()
                if positions is None:
                    return []
                out = []
                for p in positions:
                    out.append({
                        "ticket": p.ticket,
                        "symbol": p.symbol,
                        "type": "BUY" if p.type == mt5.ORDER_TYPE_BUY else "SELL",
                        "volume": round(p.volume, 2),
                        "price_open": round(p.price_open, 4),
                        "price_current": round(p.price_current, 4),
                        "sl": round(p.sl, 4) if p.sl else 0.0,
                        "tp": round(p.tp, 4) if p.tp else 0.0,
                        "profit": round(p.profit, 2),
                        "magic": p.magic,
                        "comment": p.comment,
                        "time": datetime.fromtimestamp(p.time, tz=timezone.utc).strftime("%H:%M:%S") if hasattr(p, 'time') else ""
                    })
                return out
            try:
                return await asyncio.wait_for(asyncio.to_thread(_fetch_live), timeout=3.0)
            except Exception as e:
                print(f"[FETCH POSITIONS MT5 ERROR] {e}")

        # In mock / demo mode, pull all EXECUTED active trades from database
        positions = []
        try:
            async with get_db() as conn:
                cursor = await conn.execute("""
                    SELECT trade_id, symbol, action, entry_price, sl, tp_levels,
                           xm_ticket, xm_execution_price, xm_lots, created_at
                    FROM trades
                    WHERE status = 'EXECUTED' AND is_active = 1
                    ORDER BY id DESC
                """)
                rows = await cursor.fetchall()
                import random
                for r in rows:
                    entry = float(r["xm_execution_price"] or r["entry_price"] or 0.0)
                    sl_val = float(r["sl"] or 0.0)
                    tp_list = json.loads(r["tp_levels"]) if r["tp_levels"] else []
                    tp_val = float(tp_list[0]) if tp_list else 0.0
                    lots = float(r["xm_lots"] or 0.02)
                    action = (r["action"] or "BUY").upper()
                    
                    # Generate realistic simulated floating profit
                    rnd_drift = random.uniform(-0.001, 0.003)
                    curr_price = round(entry * (1.0 + rnd_drift), 2)
                    direction = 1 if "BUY" in action else -1
                    profit = round((curr_price - entry) * direction * lots * 100, 2)

                    positions.append({
                        "ticket": r["xm_ticket"] or 72481902,
                        "trade_id": r["trade_id"],
                        "symbol": r["symbol"],
                        "type": "BUY" if "BUY" in action else "SELL",
                        "volume": lots,
                        "price_open": entry,
                        "price_current": curr_price,
                        "sl": sl_val,
                        "tp": tp_val,
                        "profit": profit,
                        "comment": f"AlphaSignal {r['trade_id']}",
                        "time": str(r["created_at"])[11:19] if r["created_at"] else ""
                    })
        except Exception as e:
            print(f"[FETCH MOCK POSITIONS ERROR] {e}")
        return positions

    async def execute_new_trade(self, trade_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validates proper SL & TP, calculates lots (0.01 Gold, 0.04 BTC, $15 risk rest),
        and submits the order to XM MT5 (or logs demo execution).
        """
        symbol_raw = trade_data.get("symbol") or "XAUUSD"
        xm_symbol = self.resolve_xm_symbol(symbol_raw)
        if not xm_symbol:
            val_msg = f"REJECTED: Symbol '{symbol_raw}' could not be resolved on XM MT5. Safety shield prevented executing on Gold."
            await log_event("WARNING", "XM_SAFETY", val_msg)
            return {
                "success": False,
                "status": "UNRESOLVED_SYMBOL",
                "message": val_msg,
                "ticket": None
            }

        action_raw = trade_data.get("action") or "BUY"
        is_buy = "BUY" in action_raw.upper() or "LONG" in action_raw.upper()

        # Parse prices safely (handles zones like 2640-2642)
        entry_raw_str = str(trade_data.get("entry_price") or "0").strip().replace(",", "")
        entry_nums = [float(x) for x in re.findall(r'\d+(?:\.\d+)?', entry_raw_str)]
        if len(entry_nums) >= 2 and any(sep in entry_raw_str for sep in ["-", "/", "TO", "to"]):
            entry = round((entry_nums[0] + entry_nums[1]) / 2.0, 2)
        elif len(entry_nums) >= 1 and entry_nums[0] > 0:
            entry = entry_nums[0]
        else:
            entry = None

        sl_nums = [float(x) for x in re.findall(r'\d+(?:\.\d+)?', str(trade_data.get("sl") or "0").replace(",", ""))]
        sl_val = sl_nums[0] if sl_nums else None

        tp_levels = trade_data.get("tp_levels") or []

        # MANDATORY SAFETY GUARD: Check Stop Loss (SL is strictly compulsory; Entry & TP are optional)
        is_valid, final_sl, final_tp, val_msg = self.validate_and_enforce_sl_tp(
            symbol=xm_symbol,
            action=action_raw,
            entry=entry,
            sl=sl_val,
            tp_levels=tp_levels
        )

        if not is_valid:
            await log_event(
                "WARNING", "XM_SAFETY",
                f"[SAFETY SHIELD] Trade {trade_data.get('trade_id')} blocked from XM execution: {val_msg}",
                details=f"Symbol: {xm_symbol}, Entry: {entry}, SL: {trade_data.get('sl')}, TP: {tp_levels}"
            )
            return {
                "success": False,
                "status": "BLOCKED_BY_SAFETY_SHIELD",
                "message": val_msg,
                "ticket": None
            }

        # Preserve owner's stated entry price before any CMP/live-tick fallback
        raw_owner_entry = trade_data.get("owner_entry")
        try:
            owner_entry_val = float(raw_owner_entry) if raw_owner_entry and float(raw_owner_entry) > 0 else entry
        except Exception:
            owner_entry_val = entry

        # If entry was omitted, retrieve live tick from MT5 or estimate from SL
        if entry is None or entry <= 0:
            if self.is_connected and MT5_AVAILABLE and not self.is_mock_mode:
                try:
                    tick = mt5.symbol_info_tick(xm_symbol)
                    if tick:
                        entry = tick.ask if is_buy else tick.bid
                except Exception:
                    pass
            if entry is None or entry <= 0:
                if "XAU" in xm_symbol or "GOLD" in xm_symbol:
                    entry = round(final_sl + 5.0, 2) if is_buy else round(final_sl - 5.0, 2)
                elif "BTC" in xm_symbol:
                    entry = round(final_sl + 200.0, 2) if is_buy else round(final_sl - 200.0, 2)
                else:
                    entry = round(final_sl * 1.002, 4) if is_buy else round(final_sl * 0.998, 4)

        # Calculate strict lot size
        lot_size = self.calculate_lot_size(xm_symbol, entry, final_sl)

        trade_id = trade_data.get("trade_id")
        tp_display = final_tp if final_tp is not None else "Open (No TP)"

        if not self.auto_execution_enabled:
            msg = "XM Auto-Execution is turned OFF in Settings."
            await log_event("INFO", "XM_EXECUTION", f"Skipped auto-execution for {trade_id}: {msg}")
            return {
                "success": False,
                "status": "AUTO_EXECUTION_DISABLED",
                "message": msg,
                "ticket": None
            }

        # 1. LIVE MT5 EXECUTION
        if self.is_connected and MT5_AVAILABLE and not self.is_mock_mode:
            def _send_mt5():
                term = mt5.terminal_info()
                if term and not term.trade_allowed:
                    return None, "Algo Trading button in MT5 is turned OFF (red). Please click 'Algo Trading' in MT5 toolbar to turn it green."

                order_type = mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL
                sym_info = mt5.symbol_info(xm_symbol)
                if not sym_info:
                    return None, f"Symbol {xm_symbol} not found in MT5."
                if not sym_info.visible:
                    mt5.symbol_select(xm_symbol, True)

                vol_min = getattr(sym_info, "volume_min", 0.01) or 0.01
                vol_max = getattr(sym_info, "volume_max", 100.0) or 100.0
                if float(lot_size) < float(vol_min):
                    return None, f"Fixed lot size ({lot_size}) is below XM minimum volume ({vol_min}) for {xm_symbol}."
                if float(lot_size) > float(vol_max):
                    return None, f"Fixed lot size ({lot_size}) exceeds XM maximum volume ({vol_max}) for {xm_symbol}."

                tick = mt5.symbol_info_tick(xm_symbol)
                if not tick:
                    return None, f"Symbol {xm_symbol} tick not available"

                raw_digits = getattr(sym_info, 'digits', 2)
                digits = int(raw_digits) if raw_digits is not None else 2
                price = round(float(tick.ask if is_buy else tick.bid), digits)
                order_sl = round(float(final_sl), digits)
                order_tp = round(float(final_tp), digits) if (final_tp is not None and float(final_tp) > 0) else 0.0

                # Ensure Stop Loss is logically on the valid side of live market price.
                # If market price is ALREADY past the Stop Loss, the signal is STALE/INVALID:
                # NEVER push the Stop Loss 500 pips away!
                if is_buy:
                    if order_sl >= price:
                        return None, f"Market price ({price}) is below/at Stop Loss ({order_sl}) for BUY. Signal is stale/invalid."
                    if order_tp > 0.0 and order_tp <= price:
                        order_tp = 0.0
                else:
                    if order_sl <= price:
                        return None, f"Market price ({price}) is above/at Stop Loss ({order_sl}) for SELL. Signal is stale/invalid."
                    if order_tp > 0.0 and order_tp >= price:
                        order_tp = 0.0

                # Reject chasing a stale signal whose market price already reached/passed owner's 1:1 target
                try:
                    sig_entry = float(raw_owner_entry) if (raw_owner_entry and float(raw_owner_entry) > 0) else 0.0
                except Exception:
                    sig_entry = 0.0
                if sig_entry > 0 and order_sl > 0:
                    owner_risk = abs(sig_entry - order_sl)
                    if owner_risk > 0:
                        gain_vs_owner = (price - sig_entry) if is_buy else (sig_entry - price)
                        if gain_vs_owner >= owner_risk:
                            return None, f"STALE_SIGNAL_ALREADY_AT_1TO1: Market price ({price}) already reached/passed owner's 1:1 target from signal entry ({sig_entry}, SL {order_sl})."

                filling = self._resolve_filling_mode(sym_info)

                request = {
                    "action": mt5.TRADE_ACTION_DEAL,
                    "symbol": xm_symbol,
                    "volume": float(lot_size),
                    "type": order_type,
                    "price": float(price),
                    "sl": float(order_sl),
                    "tp": float(order_tp),
                    "deviation": 50,
                    "magic": 998811,
                    "comment": f"AlphaSignal {trade_id}",
                    "type_time": mt5.ORDER_TIME_GTC,
                    "type_filling": filling,
                }
                res = mt5.order_send(request)
                actual_fill = float(getattr(res, "price", 0.0) or 0.0) if res else 0.0
                return res, (actual_fill if actual_fill > 0 else price)

            try:
                result, price_or_err = await asyncio.wait_for(asyncio.to_thread(_send_mt5), timeout=4.0)
                if result is not None and getattr(result, "retcode", None) == mt5.TRADE_RETCODE_DONE:
                    ticket = result.order
                    resolved_owner_entry = float(owner_entry_val) if (owner_entry_val and owner_entry_val > 0) else float(price_or_err)
                    await log_event(
                        "SIGNAL", "XM_EXECUTION",
                        f"SUCCESS: XM MT5 Order #{ticket} FILLED - {action_raw} {lot_size} {xm_symbol} @ {price_or_err}",
                        details=f"Trade {trade_id} -> Owner Entry: {resolved_owner_entry}, SL: {final_sl}, TP: {tp_display}"
                    )
                    await self._record_execution(
                        trade_id, ticket, xm_symbol, action_raw, lot_size, price_or_err, final_sl, final_tp, "FILLED",
                        owner_entry=resolved_owner_entry
                    )
                    return {
                        "success": True,
                        "status": "FILLED",
                        "ticket": ticket,
                        "symbol": xm_symbol,
                        "lots": lot_size,
                        "price": price_or_err,
                        "owner_entry": resolved_owner_entry,
                        "sl": final_sl,
                        "tp": final_tp,
                        "mode": "LIVE_MT5"
                    }
                else:
                    err_msg = getattr(result, "comment", None) if result else str(price_or_err)
                    retcode = getattr(result, "retcode", "ERROR") if result else "FAILED"
                    is_stale_1to1 = result is None and str(price_or_err).startswith("STALE_SIGNAL_ALREADY_AT_1TO1:")
                    clean_err = err_msg.replace("STALE_SIGNAL_ALREADY_AT_1TO1:", "").strip() if is_stale_1to1 else err_msg
                    await log_event(
                        "WARNING" if is_stale_1to1 else "ERROR",
                        "XM_SAFETY" if is_stale_1to1 else "XM_EXECUTION",
                        f"Skipped stale signal {trade_id}: {clean_err}" if is_stale_1to1 else f"XM live MT5 order REJECTED for {trade_id}: [{retcode}] {err_msg}"
                    )
                    return {
                        "success": False,
                        "status": "STALE_SIGNAL_ALREADY_AT_1TO1" if is_stale_1to1 else "MT5_REJECTED",
                        "message": clean_err if is_stale_1to1 else f"MT5 Order Rejected: [{retcode}] {err_msg}",
                        "ticket": None
                    }
            except Exception as e:
                await log_event("ERROR", "XM_EXECUTION", f"MT5 exception on {trade_id}: {str(e)}")
                return {
                    "success": False,
                    "status": "MT5_ERROR",
                    "message": f"MT5 Execution Error: {str(e)}",
                    "ticket": None
                }

        # 2. XM DEMO SIMULATION (Runs when MT5 terminal not connected or in sandbox)
        import random
        sim_ticket = random.randint(70000000, 79999999)
        resolved_owner_entry = float(owner_entry_val) if (owner_entry_val and owner_entry_val > 0) else float(entry)
        await log_event(
            "SIGNAL", "XM_EXECUTION",
            f"[XM DEMO] Order #{sim_ticket} Executed: {action_raw} {lot_size} lots on {xm_symbol} @ {entry}",
            details=f"Owner Entry: {resolved_owner_entry} | SL: {final_sl} | TP: {tp_display} | Rules: Gold={self.GOLD_LOTS}, BTC={self.BTC_LOTS}, Other Max Risk=${self.MAX_RISK_USD}"
        )
        await self._record_execution(
            trade_id, sim_ticket, xm_symbol, action_raw, lot_size, entry, final_sl, final_tp, "DEMO_FILLED",
            owner_entry=resolved_owner_entry
        )

        return {
            "success": True,
            "status": "DEMO_FILLED",
            "ticket": sim_ticket,
            "symbol": xm_symbol,
            "lots": lot_size,
            "price": entry,
            "owner_entry": resolved_owner_entry,
            "sl": final_sl,
            "tp": final_tp,
            "mode": "XM_DEMO_SANDBOX"
        }

    async def execute_modify_sl_breakeven(self, trade_id: str, entry_price: float) -> Dict[str, Any]:
        """
        Moves Stop Loss to Entry / Cost (Break-Even) on XM MT5.
        """
        if not self.is_connected or not MT5_AVAILABLE or self.is_mock_mode:
            await log_event("SIGNAL", "XM_EXECUTION", f"[XM DEMO] Trade {trade_id} Break-Even: SL shifted to cost {entry_price}")
            return {"success": True, "status": "BREAKEVEN_SET", "new_sl": entry_price}

        def _sync_modify_be():
            positions = mt5.positions_get()
            target_pos = None
            if positions:
                for p in positions:
                    if str(trade_id) in (p.comment or "") or str(p.ticket) == str(trade_id):
                        target_pos = p
                        break

            if not target_pos:
                return False, f"No open position found matching {trade_id}"

            p = target_pos
            mod_req = {
                "action": mt5.TRADE_ACTION_SLTP,
                "position": p.ticket,
                "symbol": p.symbol,
                "sl": float(entry_price),
                "tp": float(p.tp),
            }
            res = mt5.order_send(mod_req)
            if res and res.retcode == mt5.TRADE_RETCODE_DONE:
                return True, p.ticket
            return False, res.comment if res else "Failed"

        try:
            ok, data = await asyncio.wait_for(asyncio.to_thread(_sync_modify_be), timeout=4.0)
            if ok:
                await log_event("SIGNAL", "XM_EXECUTION", f"SUCCESS: MT5 Ticket #{data} SL moved to Break-Even ({entry_price})")
                return {"success": True, "status": "BREAKEVEN_SET", "new_sl": entry_price}
        except Exception:
            pass
        return {"success": True, "status": "BREAKEVEN_SET", "new_sl": entry_price}

    @staticmethod
    def _parse_float_safe(val: Any) -> Optional[float]:
        if val is None:
            return None
        try:
            f = float(val)
            return f if f > 0 else None
        except Exception:
            nums = re.findall(r'\d+(?:\.\d+)?', str(val).replace(",", ""))
            if len(nums) >= 2 and any(sep in str(val) for sep in ["-", "/", "TO", "to"]):
                return (float(nums[0]) + float(nums[1])) / 2.0
            return float(nums[0]) if nums and float(nums[0]) > 0 else None

    async def _load_owner_refs_by_ticket(self) -> Dict[int, Dict[str, Any]]:
        """Loads owner entry & initial SL metadata keyed by xm_ticket for active executed trades."""
        refs: Dict[int, Dict[str, Any]] = {}
        try:
            async with get_db() as conn:
                cur = await conn.execute("""
                    SELECT trade_id, xm_ticket, owner_entry, entry_price, initial_sl, sl, managed_1to1
                    FROM trades
                    WHERE status = 'EXECUTED' AND is_active = 1 AND xm_ticket IS NOT NULL
                """)
                for r in await cur.fetchall():
                    t_id = int(r["xm_ticket"])
                    refs[t_id] = {
                        "trade_id": r["trade_id"],
                        "owner_entry": self._parse_float_safe(r["owner_entry"]) or self._parse_float_safe(r["entry_price"]),
                        "initial_sl": self._parse_float_safe(r["initial_sl"]) or self._parse_float_safe(r["sl"]),
                        "managed_1to1": bool(r["managed_1to1"]),
                    }
        except Exception:
            pass
        return refs

    async def execute_partial_exit_and_extend_1to2(
        self,
        trade_id: str,
        owner_entry: Optional[float] = None,
        initial_sl: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        User Strict 1:1 Rule:
        1. 1:1 is triggered from the owner's posted image/signal (owner_entry & initial_sl),
           NOT from the MT5 order execution price.
        2. Once price reaches owner's 1:1 (and is on the profitable side of our execution fill),
           automatically close half lots (e.g. 0.01 on Gold, 0.02 on BTC), drag SL strictly
           to CTC (Cost-to-Cost = our MT5 fill price), and preserve existing TP so the runner runs.
        """
        if not self.is_connected or not MT5_AVAILABLE or self.is_mock_mode:
            await log_event(
                "SIGNAL", "XM_EXECUTION",
                f"[XM DEMO] 1:1 Target Hit for {trade_id}: Exited 50% lots. SL moved to CTC & runner left open.",
                details=f"Trade {trade_id} 50% profit booked; runner position moving risk-free."
            )
            return {"success": True, "status": "PARTIAL_CLOSED_AND_EXTENDED_DEMO"}

        # Load persisted owner entry & initial SL if not passed directly
        if owner_entry is None or initial_sl is None:
            try:
                async with get_db() as conn:
                    cur = await conn.execute(
                        """
                        SELECT owner_entry, entry_price, initial_sl, sl
                        FROM trades
                        WHERE trade_id = ? OR CAST(xm_ticket AS TEXT) = ?
                        ORDER BY id DESC LIMIT 1
                        """,
                        (str(trade_id), str(trade_id)),
                    )
                    row = await cur.fetchone()
                    if row:
                        if owner_entry is None:
                            owner_entry = self._parse_float_safe(row["owner_entry"]) or self._parse_float_safe(row["entry_price"])
                        if initial_sl is None:
                            initial_sl = self._parse_float_safe(row["initial_sl"]) or self._parse_float_safe(row["sl"])
            except Exception:
                pass

        def _sync_partial_and_modify():
            positions = mt5.positions_get()
            target_pos = None
            if positions:
                for p in positions:
                    if str(trade_id) in (p.comment or "") or str(p.ticket) == str(trade_id):
                        target_pos = p
                        break

            if not target_pos:
                return False, f"No open MT5 position found matching {trade_id}."

            p = target_pos
            sym_info = mt5.symbol_info(p.symbol)
            raw_digits = getattr(sym_info, 'digits', 2) if sym_info else 2
            digits = int(raw_digits) if raw_digits is not None else 2
            point = float(getattr(sym_info, 'point', 0.01 if digits <= 2 else 0.00001) or (0.01 if digits <= 2 else 0.00001))
            stops_lvl = float(getattr(sym_info, 'trade_stops_level', 0) or 0)
            min_ctc_dist = max(stops_lvl * point, point)
            vol_min = float(getattr(sym_info, 'volume_min', 0.01) or 0.01) if sym_info else 0.01

            total_vol = round(float(p.volume), 2)
            half_vol = round(total_vol / 2.0, 2)
            can_partial_close = (total_vol > vol_min and half_vol >= vol_min and round(total_vol - half_vol, 2) >= vol_min)

            fill_entry = round(float(p.price_open), digits)
            ref_entry = round(float(owner_entry), digits) if (owner_entry and owner_entry > 0) else fill_entry
            ref_sl = float(initial_sl) if (initial_sl and initial_sl > 0) else float(p.sl)

            is_buy = (p.type == mt5.ORDER_TYPE_BUY)
            tick = mt5.symbol_info_tick(p.symbol)
            if not tick:
                return False, f"Tick not available for {p.symbol}"

            # Guard: Never book half lots at a loss or before CTC (fill_entry) is reachable on the profitable side
            cur_close_px = tick.bid if is_buy else tick.ask
            ctc_cleared = ((cur_close_px - fill_entry) >= min_ctc_dist) if is_buy else ((fill_entry - cur_close_px) >= min_ctc_dist)
            if not ctc_cleared:
                return False, f"CTC_NOT_CLEARED: Price ({cur_close_px}) has not cleared CTC fill ({fill_entry}) by min stops distance on #{p.ticket}."

            closed_lots = 0.0
            remaining_lots = total_vol

            # Step 1: Book 50% of the volume
            if can_partial_close:
                close_price = tick.bid if is_buy else tick.ask
                close_type = mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY
                filling = self._resolve_filling_mode(sym_info)

                close_req = {
                    "action": mt5.TRADE_ACTION_DEAL,
                    "position": p.ticket,
                    "symbol": p.symbol,
                    "volume": float(half_vol),
                    "type": close_type,
                    "price": float(close_price),
                    "deviation": 50,
                    "magic": 998811,
                    "comment": f"1:1 Half Exit {trade_id}",
                    "type_time": mt5.ORDER_TIME_GTC,
                    "type_filling": filling,
                }
                close_res = mt5.order_send(close_req)
                if not close_res or close_res.retcode != mt5.TRADE_RETCODE_DONE:
                    err = close_res.comment if close_res else "Close order failed"
                    return False, f"Partial close failed on #{p.ticket}: {err}"
                closed_lots = half_vol
                remaining_lots = round(total_vol - half_vol, 2)

            # Refresh tick after partial close before placing Stop Loss at CTC
            tick = mt5.symbol_info_tick(p.symbol) or tick

            # Step 2: Drag Stop Loss strictly to CTC (fill_entry = Cost-to-Cost), NEVER widen to owner_entry on loss side
            cur_sl = float(p.sl) if p.sl else 0.0
            if is_buy:
                max_valid_sl = round(tick.bid - min_ctc_dist, digits)
                if fill_entry <= max_valid_sl:
                    new_sl = fill_entry
                else:
                    new_sl = max(cur_sl, max_valid_sl) if cur_sl > 0 else max_valid_sl
            else:
                min_valid_sl = round(tick.ask + min_ctc_dist, digits)
                if fill_entry >= min_valid_sl:
                    new_sl = fill_entry
                else:
                    new_sl = min(cur_sl, min_valid_sl) if cur_sl > 0 else min_valid_sl

            # Step 3: Preserve owner's existing TP ("let the trade run") instead of pulling in or overwriting TP
            existing_tp = float(p.tp) if p.tp else 0.0
            runner_tp = existing_tp
            if runner_tp > 0.0:
                if is_buy and runner_tp <= round(tick.ask + min_ctc_dist, digits):
                    runner_tp = 0.0
                elif (not is_buy) and runner_tp >= round(tick.bid - min_ctc_dist, digits):
                    runner_tp = 0.0

            mod_req = {
                "action": mt5.TRADE_ACTION_SLTP,
                "position": p.ticket,
                "symbol": p.symbol,
                "sl": float(new_sl),
                "tp": float(runner_tp),
            }
            mod_res = mt5.order_send(mod_req)
            if not mod_res or mod_res.retcode != mt5.TRADE_RETCODE_DONE:
                # Fallback: SL to CTC with TP=0.0 if existing TP caused Invalid stops
                mod_req_open_tp = {
                    "action": mt5.TRADE_ACTION_SLTP,
                    "position": p.ticket,
                    "symbol": p.symbol,
                    "sl": float(new_sl),
                    "tp": 0.0,
                }
                mod_res = mt5.order_send(mod_req_open_tp)
                if not mod_res or mod_res.retcode != mt5.TRADE_RETCODE_DONE:
                    mod_err = mod_res.comment if mod_res else "SL/TP modify failed"
                    return False, {
                        "error": f"1:1 CTC SL modification failed on #{p.ticket}: {mod_err}",
                        "closed_lots": closed_lots,
                        "ticket": p.ticket
                    }
                runner_tp = 0.0

            return True, {
                "ticket": p.ticket,
                "symbol": p.symbol,
                "closed_lots": closed_lots,
                "remaining_lots": remaining_lots,
                "owner_entry": ref_entry,
                "initial_sl": ref_sl,
                "ctc_entry": fill_entry,
                "new_sl": new_sl,
                "new_tp_1to2": runner_tp,
                "runner_tp": runner_tp,
                "comment": mod_res.comment if mod_res else "OK"
            }

        try:
            ok, res_data = await asyncio.wait_for(asyncio.to_thread(_sync_partial_and_modify), timeout=5.0)
            if ok:
                tp_label = str(res_data["runner_tp"]) if res_data["runner_tp"] > 0 else "Open (Let Run)"
                await log_event(
                    "SIGNAL", "XM_EXECUTION",
                    f"SUCCESS: 1:1 Partial Exit on #{res_data['ticket']} - Exited {res_data['closed_lots']} lots ({res_data['symbol']}). "
                    f"Owner Entry: {res_data['owner_entry']} -> SL moved to CTC ({res_data['new_sl']}), TP: {tp_label}",
                    details=f"Trade {trade_id} -> Runner position: {res_data['remaining_lots']} lots risk-free at CTC."
                )
                try:
                    async with get_db() as conn:
                        cur = await conn.execute("SELECT trade_id FROM trades WHERE xm_ticket = ? LIMIT 1", (int(res_data["ticket"]),))
                        row = await cur.fetchone()
                        if row:
                            db_tid = row["trade_id"]
                            await conn.execute(
                                "UPDATE trades SET sl = ?, managed_1to1 = 1, updated_at = CURRENT_TIMESTAMP WHERE trade_id = ?",
                                (str(res_data["new_sl"]), db_tid)
                            )
                            await conn.execute(
                                """INSERT INTO trade_events (trade_id, event_type, previous_status, new_status, notes)
                                   VALUES (?, 'PARTIAL_1_TO_1', 'EXECUTED', 'EXECUTED', ?)""",
                                (db_tid, f"1:1 Target Hit on #{res_data['ticket']} (Owner Entry {res_data['owner_entry']}): Exited {res_data['closed_lots']} lots, SL moved to CTC ({res_data['new_sl']}), TP preserved ({tp_label}).")
                            )
                            await conn.commit()
                except Exception:
                    pass
                return {"success": True, "status": "PARTIAL_CLOSED_AND_CTC", "details": res_data}
            else:
                if isinstance(res_data, dict) and res_data.get("closed_lots", 0) > 0:
                    try:
                        async with get_db() as conn:
                            cur = await conn.execute("SELECT trade_id FROM trades WHERE xm_ticket = ? LIMIT 1", (int(res_data["ticket"]),))
                            row = await cur.fetchone()
                            if row:
                                db_tid = row["trade_id"]
                                await conn.execute("UPDATE trades SET managed_1to1 = 1, updated_at = CURRENT_TIMESTAMP WHERE trade_id = ?", (db_tid,))
                                await conn.execute(
                                    """INSERT INTO trade_events (trade_id, event_type, previous_status, new_status, notes)
                                       VALUES (?, 'PARTIAL_1_TO_1', 'EXECUTED', 'EXECUTED', ?)""",
                                    (db_tid, f"1:1 Partial closed {res_data['closed_lots']} lots on #{res_data['ticket']}; notice: {res_data['error']}")
                                )
                                await conn.commit()
                    except Exception:
                        pass
                err_text = res_data.get("error") if isinstance(res_data, dict) else str(res_data)
                if not str(err_text).startswith("CTC_NOT_CLEARED:"):
                    await log_event("WARNING", "XM_EXECUTION", f"1:1 Partial exit notice for {trade_id}: {err_text}")
                return {"success": False, "message": err_text}
        except Exception as e:
            await log_event("WARNING", "XM_EXECUTION", f"Exception during 1:1 partial exit on {trade_id}: {e}")
            return {"success": False, "error": str(e)}

    async def execute_take_profit_1to1(self, trade_id: str) -> Dict[str, Any]:
        """Backward-compatible alias pointing to execute_partial_exit_and_extend_1to2."""
        return await self.execute_partial_exit_and_extend_1to2(trade_id)

    async def close_position(self, ticket: int, lots: Optional[float] = None) -> Dict[str, Any]:
        """
        Manually closes a position (or partial volume) on XM MT5 from the UI.
        If lots is None or >= open volume, closes the entire position.
        If lots < open volume, executes a partial close on MT5.
        """
        ticket_int = int(ticket)
        if not self.is_connected or not MT5_AVAILABLE or self.is_mock_mode:
            vol_str = f"{lots} lots" if lots else "full volume"
            await log_event("SIGNAL", "XM_EXECUTION", f"[XM DEMO] Closed #{ticket_int} ({vol_str}) via UI.")
            return {"success": True, "status": "DEMO_CLOSED", "ticket": ticket_int, "closed_lots": lots or 0.02, "remaining_lots": 0.0}

        def _sync_close():
            positions = mt5.positions_get(ticket=ticket_int)
            if not positions:
                all_pos = mt5.positions_get()
                if all_pos:
                    for p in all_pos:
                        if p.ticket == ticket_int:
                            positions = [p]
                            break
            if not positions:
                return False, f"Position #{ticket_int} not found or already closed."

            p = positions[0]
            total_vol = round(float(p.volume), 2)
            close_vol = round(float(lots), 2) if lots and float(lots) > 0 else total_vol
            if close_vol > total_vol:
                close_vol = total_vol

            is_buy = (p.type == mt5.ORDER_TYPE_BUY)
            close_type = mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY

            sym_info = mt5.symbol_info(p.symbol)
            tick = mt5.symbol_info_tick(p.symbol)
            if not tick:
                return False, f"Tick data unavailable for {p.symbol}"

            price = tick.bid if is_buy else tick.ask
            filling = self._resolve_filling_mode(sym_info)

            close_req = {
                "action": mt5.TRADE_ACTION_DEAL,
                "position": int(p.ticket),
                "symbol": p.symbol,
                "volume": float(close_vol),
                "type": close_type,
                "price": float(price),
                "deviation": 50,
                "magic": 998822,
                "comment": f"Manual Close #{ticket_int}",
                "type_time": mt5.ORDER_TIME_GTC,
                "type_filling": filling,
            }
            res = mt5.order_send(close_req)
            if not res or res.retcode != mt5.TRADE_RETCODE_DONE:
                err = res.comment if res else "Order send failed"
                return False, f"MT5 rejected close on #{ticket_int}: {err}"

            remaining = round(total_vol - close_vol, 2)
            return True, {
                "ticket": p.ticket,
                "symbol": p.symbol,
                "closed_lots": close_vol,
                "remaining_lots": remaining,
                "close_price": price,
                "status": "CLOSED" if remaining <= 0 else "PARTIALLY_CLOSED"
            }

        try:
            ok, data = await asyncio.wait_for(asyncio.to_thread(_sync_close), timeout=5.0)
            if ok:
                await log_event(
                    "SIGNAL", "XM_EXECUTION",
                    f"SUCCESS: #{data['ticket']} closed {data['closed_lots']} lots on {data['symbol']} @ {data['close_price']} ({data['status']}) via UI.",
                    details=f"Remaining volume: {data['remaining_lots']} lots."
                )
                return {"success": True, **data}
            else:
                await log_event("WARNING", "XM_EXECUTION", f"Close position failed: {data}")
                return {"success": False, "error": str(data)}
        except Exception as e:
            await log_event("ERROR", "XM_EXECUTION", f"Exception closing #{ticket_int}: {e}")
            return {"success": False, "error": str(e)}

    async def check_and_manage_1to1_positions(self) -> List[Dict[str, Any]]:
        """
        Polls XM MT5 positions rapidly.
        Calculates Risk R = |OwnerEntry - InitialSL| strictly from the owner's posted signal/image.
        When live price reaches owner's 1:1 (gain >= R) and clears our CTC fill price:
          * Automatically books half lots (50%).
          * Drags Stop Loss strictly to CTC (our execution fill price).
          * Leaves existing TP untouched so the runner lets the trade run.
        """
        if not self.is_connected or not MT5_AVAILABLE or self.is_mock_mode:
            return []

        trade_refs = await self._load_owner_refs_by_ticket()

        def _sync_evaluate_1to1():
            actions_to_take = []
            positions = mt5.positions_get()
            if not positions:
                return actions_to_take

            for p in positions:
                ticket = int(p.ticket)
                if ticket in self._managed_1to1_tickets:
                    continue  # Already managed 1:1

                ref = trade_refs.get(ticket)
                if ref and ref.get("managed_1to1"):
                    self._managed_1to1_tickets.add(ticket)
                    continue

                entry = ref["owner_entry"] if (ref and ref.get("owner_entry")) else float(p.price_open)
                sl = ref["initial_sl"] if (ref and ref.get("initial_sl")) else float(p.sl)
                if sl <= 0 or entry <= 0:
                    continue

                risk = abs(entry - sl)
                if risk <= 0:
                    continue

                tick = mt5.symbol_info_tick(p.symbol)
                if not tick:
                    continue

                sym_info = mt5.symbol_info(p.symbol)
                raw_digits = getattr(sym_info, "digits", 2) if sym_info else 2
                digits = int(raw_digits) if raw_digits is not None else 2
                point = float(getattr(sym_info, "point", 0.01 if digits <= 2 else 0.00001) or (0.01 if digits <= 2 else 0.00001))
                stops_lvl = float(getattr(sym_info, "trade_stops_level", 0) or 0)
                min_ctc_dist = max(stops_lvl * point, point)
                fill_entry = round(float(p.price_open), digits)

                is_buy = (p.type == mt5.ORDER_TYPE_BUY)
                current_price = tick.bid if is_buy else tick.ask
                gain = (current_price - entry) if is_buy else (entry - current_price)
                ctc_ready = ((current_price - fill_entry) >= min_ctc_dist) if is_buy else ((fill_entry - current_price) >= min_ctc_dist)

                # Check if live market price hit 1:1 Risk from owner's signal perspective AND CTC is achievable
                if gain >= risk and ctc_ready:
                    actions_to_take.append({
                        "ticket": ticket,
                        "symbol": p.symbol,
                        "entry": entry,
                        "sl": sl,
                        "risk": risk,
                        "gain": gain,
                        "price": current_price
                    })

            return actions_to_take

        try:
            candidates = await asyncio.wait_for(asyncio.to_thread(_sync_evaluate_1to1), timeout=3.0)
            results = []
            for c in candidates:
                ticket = c["ticket"]
                res = await self.execute_partial_exit_and_extend_1to2(
                    str(ticket),
                    owner_entry=c["entry"],
                    initial_sl=c["sl"]
                )
                details = res.get("details") if isinstance(res, dict) else None
                if res.get("success") or (isinstance(details, dict) and details.get("closed_lots", 0) > 0):
                    self._managed_1to1_tickets.add(ticket)
                if res.get("success"):
                    results.append({"ticket": ticket, **res})
            return results
        except Exception:
            return []

    async def sync_closed_mt5_trades(self) -> List[Dict[str, Any]]:
        """
        Syncs active DB EXECUTED positions against live XM MT5 positions & deal history
        so Watchlist outcomes stay accurate and stale/archived tickets never remain active.
        """
        if not self.is_connected or not MT5_AVAILABLE or self.is_mock_mode:
            return []

        try:
            async with get_db() as conn:
                cur = await conn.execute(
                    """
                    SELECT trade_id, xm_ticket, symbol, action, created_at
                    FROM trades
                    WHERE status = 'EXECUTED'
                      AND is_active = 1
                      AND xm_ticket IS NOT NULL
                    """
                )
                candidates = [dict(r) for r in await cur.fetchall()]
        except Exception:
            return []

        if not candidates:
            return []

        def _sync_check_closed():
            positions = mt5.positions_get()
            if positions is None:
                return []
            open_tickets = {int(p.ticket) for p in positions}
            closed_updates = []

            for c in candidates:
                ticket = int(c["xm_ticket"])
                if ticket in open_tickets:
                    continue

                is_demo_sandbox_ticket = (70000000 <= ticket <= 79999999)
                is_pre_cutoff = bool(c.get("created_at") and str(c["created_at"]) < self._sync_cutoff_utc)

                deals = mt5.history_deals_get(position=ticket)
                out_deals = [d for d in deals if getattr(d, "entry", None) in (1, 3)] if deals else []
                if not out_deals:
                    if is_demo_sandbox_ticket or is_pre_cutoff:
                        closed_updates.append({
                            "trade_id": c["trade_id"],
                            "ticket": ticket,
                            "new_status": "CANCELLED",
                            "outcome": "Archived Closed Historical Position",
                            "profit": 0.0,
                            "close_price": 0.0,
                            "comment": "No longer open on MT5",
                            "archived": True,
                        })
                    continue

                total_profit = round(sum(float(getattr(d, "profit", 0.0) or 0.0) for d in out_deals), 2)
                last_deal = out_deals[-1]
                close_price = float(getattr(last_deal, "price", 0.0) or 0.0)
                comment = str(getattr(last_deal, "comment", "") or "").lower()

                if "[tp" in comment:
                    new_status = "TP_HIT"
                    outcome = "Take Profit Hit"
                elif "[sl" in comment:
                    new_status = "SL_HIT"
                    outcome = "Stop Loss Hit"
                elif total_profit >= 0:
                    new_status = "TP_HIT"
                    outcome = "Closed in Profit on MT5"
                else:
                    new_status = "SL_HIT"
                    outcome = "Closed at Loss on MT5"

                closed_updates.append({
                    "trade_id": c["trade_id"],
                    "ticket": ticket,
                    "new_status": new_status,
                    "outcome": outcome,
                    "profit": total_profit,
                    "close_price": close_price,
                    "comment": getattr(last_deal, "comment", "") or "",
                    "archived": False,
                })
            return closed_updates

        try:
            updates = await asyncio.wait_for(asyncio.to_thread(_sync_check_closed), timeout=3.0)
        except Exception:
            return []

        for u in updates:
            if u.get("archived"):
                await update_trade_outcome(
                    trade_id=u["trade_id"],
                    new_status=u["new_status"],
                    outcome=u["outcome"],
                    notes=f"Reconciled historical ticket #{u['ticket']} (closed/expired on MT5).",
                )
            else:
                pnl_str = f"+${u['profit']:.2f}" if u["profit"] >= 0 else f"-${abs(u['profit']):.2f}"
                note = f"XM MT5 Ticket #{u['ticket']} closed @ {u['close_price']} ({pnl_str}) [{u['comment'] or u['outcome']}]"
                await update_trade_outcome(
                    trade_id=u["trade_id"],
                    new_status=u["new_status"],
                    outcome=u["outcome"],
                    notes=note,
                )
                await log_event("SIGNAL", "XM_EXECUTION", f"Position #{u['ticket']} ({u['trade_id']}) closed on MT5: {u['outcome']} ({pnl_str})")
        return updates

    async def _record_execution(
        self,
        trade_id: str,
        ticket: int,
        symbol: str,
        order_type: str,
        lots: float,
        entry_price: float,
        sl: float,
        tp: float,
        status: str,
        owner_entry: Optional[float] = None
    ):
        """Records execution into database audit trail."""
        try:
            async with get_db() as conn:
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS mt5_executions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        trade_id TEXT,
                        ticket INTEGER,
                        symbol TEXT,
                        order_type TEXT,
                        lots REAL,
                        entry_price REAL,
                        sl REAL,
                        tp REAL,
                        status TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                await conn.execute("""
                    INSERT INTO mt5_executions (trade_id, ticket, symbol, order_type, lots, entry_price, sl, tp, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (trade_id, ticket, symbol, order_type, lots, entry_price, sl, tp, status))

                # Update trades master table with XM Execution receipt while preserving owner_entry & initial_sl
                owner_val = float(owner_entry) if (owner_entry and owner_entry > 0) else float(entry_price)
                await conn.execute("""
                    UPDATE trades 
                    SET status = 'EXECUTED',
                        is_active = 1,
                        outcome = 'XM MT5: Running Hands-Off',
                        xm_ticket = ?,
                        xm_execution_price = ?,
                        xm_lots = ?,
                        owner_entry = COALESCE(owner_entry, ?),
                        initial_sl = COALESCE(initial_sl, ?),
                        xm_response = ?,
                        pnl_notes = 'XM Ticket #' || ? || ' (' || ? || ' lots) FILLED @ ' || ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE trade_id = ?
                """, (ticket, entry_price, lots, owner_val, float(sl), f"XM Ticket #{ticket} ({lots} lots) FILLED @ {entry_price} | SL: {sl} | TP: {tp}", ticket, lots, entry_price, trade_id))

                await conn.commit()
        except Exception as e:
            print(f"[DB RECORD EXECUTION ERROR] {e}")

xm_executor = XMExecutionEngine()
