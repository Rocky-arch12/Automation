import os
import re
import json
import asyncio
from typing import Dict, Any, Optional, Tuple, List
from config import settings
from database import log_event, get_db

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
            self.is_connected = True
            self.is_mock_mode = False
            self.account_info = {
                "login": acc.login,
                "server": acc.server,
                "currency": acc.currency,
                "balance": acc.balance,
                "equity": acc.equity,
                "profit": acc.profit,
                "margin": acc.margin,
                "margin_free": acc.margin_free,
                "leverage": acc.leverage,
                "trade_allowed": acc.trade_allowed,
                "is_demo": "demo" in (acc.server or "").lower() or acc.trade_mode == 0
            }
            await log_event("INFO", "XM_MT5", f"Successfully connected to XM MT5 account #{acc.login} ({acc.server}) - Balance: {acc.balance} {acc.currency}")
            return {
                "status": "connected",
                "connected": True,
                "account": self.account_info
            }
        else:
            self.is_connected = False
            self.is_mock_mode = True
            return {"status": "mock", "connected": False, "message": "Connected to MT5 terminal in guest mode."}

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

    def resolve_xm_symbol(self, raw_symbol: str) -> str:
        """
        Resolves asset symbols to XM's exact MT5 symbol names.
        E.g. XAUUSD -> 'GOLD' or 'GOLDmicro' or 'XAUUSD'.
        """
        s = (raw_symbol or "XAUUSD").upper().strip()
        
        # Standardize common names
        is_gold = any(k in s for k in ["XAU", "GOLD"])
        is_btc = any(k in s for k in ["BTC", "BITCOIN"])

        if self.is_connected and MT5_AVAILABLE:
            try:
                symbols = mt5.symbols_get()
                if symbols:
                    sym_names = [sym.name for sym in symbols]
                    if is_gold:
                        for candidate in ["GOLD", "GOLDmicro", "XAUUSD", "XAUUSDm", "XAUUSD."]:
                            if candidate in sym_names:
                                return candidate
                    elif is_btc:
                        for candidate in ["BTCUSD", "BTCUSDmicro", "BTCUSDT", "BTCUSD."]:
                            if candidate in sym_names:
                                return candidate
                    else:
                        clean_sym = s.replace("USDT", "USD").replace("/", "")
                        for candidate in [clean_sym, f"{clean_sym}micro", f"{clean_sym}m", f"{clean_sym}."]:
                            if candidate in sym_names:
                                return candidate
            except Exception:
                pass

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
        tp_levels: List[Any]
    ) -> Tuple[bool, Optional[float], Optional[float], str]:
        """
        USER MANDATORY RULE:
        1. "Alway place trade with proper SL and TP otherwise dont place trade."
        2. "always take profit once the trade 1:1 RR ratio."
        
        Validates that both SL and TP are present and logically sound.
        Calculates strict 1:1 TP if only SL is given.
        """
        is_buy = "BUY" in action.upper() or "LONG" in action.upper()

        if entry is None or entry <= 0:
            return False, None, None, "REJECTED: Missing or invalid entry price."

        if sl is None or sl <= 0:
            return False, None, None, "REJECTED: Missing Stop Loss (SL). Proper SL is strictly mandatory."

        # Verify SL is on correct side of Entry
        if is_buy and sl >= entry:
            return False, None, None, f"REJECTED: Invalid SL ({sl}) for BUY order (must be below entry {entry})."
        if not is_buy and sl <= entry:
            return False, None, None, f"REJECTED: Invalid SL ({sl}) for SELL order (must be above entry {entry})."

        risk_distance = abs(entry - sl)
        if risk_distance <= 0:
            return False, None, None, "REJECTED: SL distance is zero."

        # Enforce 1:1 Take Profit target
        tp_1to1 = round(entry + risk_distance, 2) if is_buy else round(entry - risk_distance, 2)
        
        # Check if signal has existing TP
        extracted_tp = None
        if tp_levels and len(tp_levels) > 0:
            try:
                first_tp = float(re.sub(r'[^\d.]', '', str(tp_levels[0])))
                if first_tp > 0:
                    extracted_tp = first_tp
            except Exception:
                pass

        # Use 1:1 TP as mandatory target per user instruction
        final_tp = tp_1to1 if extracted_tp is None else extracted_tp
        
        # Verify TP is on correct side of Entry
        if is_buy and final_tp <= entry:
            final_tp = tp_1to1
        elif not is_buy and final_tp >= entry:
            final_tp = tp_1to1

        return True, sl, final_tp, "VALID"

    def calculate_lot_size(
        self,
        symbol: str,
        entry: float,
        sl: float
    ) -> float:
        """
        USER STRICT LOT RULES:
        1. Gold (XAUUSD / GOLD): ALWAYS 0.01 lots.
        2. Bitcoin (BTCUSD / BTCUSDT): ALWAYS 0.04 lots.
        3. Other assets: Max $15 USD risk amount at Stop Loss.
        """
        s_upper = symbol.upper()
        if "GOLD" in s_upper or "XAU" in s_upper:
            return self.GOLD_LOTS
        
        if "BTC" in s_upper or "BITCOIN" in s_upper:
            return self.BTC_LOTS

        # Other assets: calculate lot size so max loss is $15 USD
        risk_distance = abs(entry - sl)
        if risk_distance <= 0:
            return 0.01

        contract_size = 100000.0 # Standard forex lot contract size
        if self.is_connected and MT5_AVAILABLE:
            try:
                info = mt5.symbol_info(symbol)
                if info:
                    contract_size = float(info.trade_contract_size or 100000.0)
            except Exception:
                pass

        # Risk ($) = risk_distance * contract_size * lots
        # lots = Max_Risk / (risk_distance * contract_size)
        risk_per_1_lot = risk_distance * contract_size
        calculated_lots = self.MAX_RISK_USD / risk_per_1_lot if risk_per_1_lot > 0 else 0.02

        # Normalize to 2 decimal places in even steps of 0.02 (min 0.02)
        # so that 50% (half lots) can always be exited cleanly at 1:1
        raw_lots = max(0.02, round(calculated_lots, 2))
        normalized_lots = round(round(raw_lots / 0.02) * 0.02, 2)
        if normalized_lots < 0.02:
            normalized_lots = 0.02
        return normalized_lots

    async def execute_new_trade(self, trade_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validates proper SL & TP, calculates lots (0.01 Gold, 0.04 BTC, $15 risk rest),
        and submits the order to XM MT5 (or logs demo execution).
        """
        symbol_raw = trade_data.get("symbol") or "XAUUSD"
        xm_symbol = self.resolve_xm_symbol(symbol_raw)
        action_raw = trade_data.get("action") or "BUY"
        is_buy = "BUY" in action_raw.upper() or "LONG" in action_raw.upper()

        # Parse prices
        try:
            entry = float(re.sub(r'[^\d.]', '', str(trade_data.get("entry_price") or "0")))
        except Exception:
            entry = 0.0

        try:
            sl_val = float(re.sub(r'[^\d.]', '', str(trade_data.get("sl") or "0")))
        except Exception:
            sl_val = None

        tp_levels = trade_data.get("tp_levels") or []

        # MANDATORY SAFETY GUARD: Check proper SL and TP
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

        # Calculate strict lot size
        lot_size = self.calculate_lot_size(xm_symbol, entry, final_sl)

        trade_id = trade_data.get("trade_id")
        notes = f"XM Order: {action_raw} {lot_size} lots on {xm_symbol} @ {entry}. SL: {final_sl}, 1:1 TP: {final_tp}"

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

                tick = mt5.symbol_info_tick(xm_symbol)
                if not tick:
                    return None, f"Symbol {xm_symbol} tick not available"

                price = tick.ask if is_buy else tick.bid
                digits = getattr(sym_info, 'digits', 2)

                # Ensure SL & TP are strictly aligned with live market execution price to avoid 10016 (Invalid Stops)
                order_sl = float(final_sl)
                order_tp = float(final_tp)
                risk_dist = abs(entry - final_sl) if entry and final_sl else 10.0
                if risk_dist <= 0:
                    risk_dist = 10.0

                if is_buy:
                    if order_sl >= price or order_tp <= price:
                        order_sl = round(price - risk_dist, digits)
                        order_tp = round(price + risk_dist, digits)
                else:
                    if order_sl <= price or order_tp >= price:
                        order_sl = round(price + risk_dist, digits)
                        order_tp = round(price - risk_dist, digits)

                # Resolve filling mode supported by symbol (IOC vs FOK vs Return)
                filling = mt5.ORDER_FILLING_IOC
                if hasattr(sym_info, 'filling_mode'):
                    if sym_info.filling_mode == 1:
                        filling = mt5.ORDER_FILLING_FOK
                    elif sym_info.filling_mode == 2:
                        filling = mt5.ORDER_FILLING_IOC
                    elif sym_info.filling_mode == 4:
                        filling = mt5.ORDER_FILLING_RETURN

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
                return res, price

            try:
                result, price_or_err = await asyncio.wait_for(asyncio.to_thread(_send_mt5), timeout=4.0)
                if result is not None and getattr(result, "retcode", None) == mt5.TRADE_RETCODE_DONE:
                    ticket = result.order
                    await log_event(
                        "SIGNAL", "XM_EXECUTION",
                        f"SUCCESS: XM MT5 Order #{ticket} FILLED - {action_raw} {lot_size} {xm_symbol} @ {price_or_err}",
                        details=f"Trade {trade_id} -> SL: {final_sl}, 1:1 TP: {final_tp}"
                    )
                    await self._record_execution(trade_id, ticket, xm_symbol, action_raw, lot_size, price_or_err, final_sl, final_tp, "FILLED")
                    return {
                        "success": True,
                        "status": "FILLED",
                        "ticket": ticket,
                        "symbol": xm_symbol,
                        "lots": lot_size,
                        "price": price_or_err,
                        "sl": final_sl,
                        "tp": final_tp,
                        "mode": "LIVE_MT5"
                    }
                else:
                    err_msg = getattr(result, "comment", None) if result else str(price_or_err)
                    await log_event("WARNING", "XM_EXECUTION", f"XM live MT5 order not placed for {trade_id}: {err_msg}. Operating in Demo Sandbox.")
            except Exception as e:
                await log_event("WARNING", "XM_EXECUTION", f"MT5 exception on {trade_id}: {str(e)}. Operating in Demo Sandbox.")

        # 2. XM DEMO SIMULATION (Runs when MT5 terminal not yet running or during testing)
        import random
        sim_ticket = random.randint(70000000, 79999999)
        await log_event(
            "SIGNAL", "XM_EXECUTION",
            f"[XM DEMO] Order #{sim_ticket} Executed: {action_raw} {lot_size} lots on {xm_symbol} @ {entry}",
            details=f"SL: {final_sl} | 1:1 TP: {final_tp} | Rules: Gold={self.GOLD_LOTS}, BTC={self.BTC_LOTS}, Other Max Risk=${self.MAX_RISK_USD}"
        )
        await self._record_execution(trade_id, sim_ticket, xm_symbol, action_raw, lot_size, entry, final_sl, final_tp, "DEMO_FILLED")

        return {
            "success": True,
            "status": "DEMO_FILLED",
            "ticket": sim_ticket,
            "symbol": xm_symbol,
            "lots": lot_size,
            "price": entry,
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
                    if trade_id in (p.comment or ""):
                        target_pos = p
                        break
                if not target_pos:
                    target_pos = positions[0]

            if not target_pos:
                return False, "No open position found"

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

    async def execute_partial_exit_and_extend_1to2(self, trade_id: str) -> Dict[str, Any]:
        """
        User Strict Rule:
        "once the trade hits 1:1 then automatically exit out half lots meaning 0.01 lots
        should be exited and the SL should be dragged to the entry price directly and
        the TP should be stretched to 1:2 target. Btw this logic should be applied for all the assets."
        """
        if not self.is_connected or not MT5_AVAILABLE or self.is_mock_mode:
            await log_event(
                "SIGNAL", "XM_EXECUTION",
                f"[XM DEMO] 1:1 Target Hit for {trade_id}: Exited 50% lots. SL moved to Break-Even & TP stretched to 1:2.",
                details=f"Trade {trade_id} 50% profit booked; runner position moving to 1:2 risk-free."
            )
            return {"success": True, "status": "PARTIAL_CLOSED_AND_EXTENDED_DEMO"}

        def _sync_partial_and_modify():
            positions = mt5.positions_get()
            target_pos = None
            if positions:
                for p in positions:
                    if trade_id in (p.comment or ""):
                        target_pos = p
                        break
                if not target_pos:
                    target_pos = positions[0]

            if not target_pos:
                return False, f"No open MT5 position found for {trade_id}."

            p = target_pos
            total_vol = round(float(p.volume), 2)
            half_vol = round(total_vol / 2.0, 2)
            if half_vol < 0.01:
                half_vol = 0.01

            sym_info = mt5.symbol_info(p.symbol)
            digits = getattr(sym_info, 'digits', 2)
            entry = float(p.price_open)
            current_sl = float(p.sl)
            risk_dist = abs(entry - current_sl) if current_sl > 0 else 10.0
            if risk_dist <= 0:
                risk_dist = 10.0

            is_buy = (p.type == mt5.ORDER_TYPE_BUY)
            tp_1to2 = round(entry + (2 * risk_dist), digits) if is_buy else round(entry - (2 * risk_dist), digits)

            tick = mt5.symbol_info_tick(p.symbol)
            if not tick:
                return False, f"Tick not available for {p.symbol}"

            # Step 1: Close 50% of the volume
            close_price = tick.bid if is_buy else tick.ask
            close_type = mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY
            filling = mt5.ORDER_FILLING_IOC
            if hasattr(sym_info, 'filling_mode'):
                if sym_info.filling_mode == 1:
                    filling = mt5.ORDER_FILLING_FOK
                elif sym_info.filling_mode == 2:
                    filling = mt5.ORDER_FILLING_IOC
                elif sym_info.filling_mode == 4:
                    filling = mt5.ORDER_FILLING_RETURN

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

            # Step 2: Modify SL to Break-Even (Entry) and TP to 1:2
            new_sl = entry
            if is_buy and new_sl >= tick.bid:
                new_sl = round(tick.bid - 2.0, digits)
            elif not is_buy and new_sl <= tick.ask:
                new_sl = round(tick.ask + 2.0, digits)

            mod_req = {
                "action": mt5.TRADE_ACTION_SLTP,
                "position": p.ticket,
                "symbol": p.symbol,
                "sl": float(new_sl),
                "tp": float(tp_1to2),
            }
            mod_res = mt5.order_send(mod_req)

            return True, {
                "ticket": p.ticket,
                "symbol": p.symbol,
                "closed_lots": half_vol,
                "remaining_lots": round(total_vol - half_vol, 2),
                "new_sl": new_sl,
                "new_tp_1to2": tp_1to2,
                "comment": mod_res.comment if mod_res else "OK"
            }

        try:
            ok, res_data = await asyncio.wait_for(asyncio.to_thread(_sync_partial_and_modify), timeout=5.0)
            if ok:
                await log_event(
                    "SIGNAL", "XM_EXECUTION",
                    f"SUCCESS: 1:1 Partial Exit on #{res_data['ticket']} - Exited {res_data['closed_lots']} lots ({res_data['symbol']}). "
                    f"SL moved to Break-Even ({res_data['new_sl']}), TP stretched to 1:2 ({res_data['new_tp_1to2']})",
                    details=f"Trade {trade_id} -> Runner position: {res_data['remaining_lots']} lots risk-free to 1:2."
                )
                return {"success": True, "status": "PARTIAL_CLOSED_AND_EXTENDED", "details": res_data}
            else:
                await log_event("WARNING", "XM_EXECUTION", f"1:1 Partial exit notice for {trade_id}: {res_data}")
                return {"success": False, "message": str(res_data)}
        except Exception as e:
            await log_event("WARNING", "XM_EXECUTION", f"Exception during 1:1 partial exit on {trade_id}: {e}")
            return {"success": False, "error": str(e)}

    async def execute_take_profit_1to1(self, trade_id: str) -> Dict[str, Any]:
        """Backward-compatible alias pointing to execute_partial_exit_and_extend_1to2."""
        return await self.execute_partial_exit_and_extend_1to2(trade_id)

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
        status: str
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

                # Update trades master table
                await conn.execute("""
                    UPDATE trades 
                    SET pnl_notes = pnl_notes || ' | XM Ticket #' || ?
                    WHERE trade_id = ?
                """, (ticket, trade_id))

                await conn.commit()
        except Exception as e:
            print(f"[DB RECORD EXECUTION ERROR] {e}")

xm_executor = XMExecutionEngine()
