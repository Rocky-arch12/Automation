import * as React from 'react';
import * as RechartsPrimitive from 'recharts';
import './chart.css';

const THEMES = { light: '', dark: '.dark' };
const INITIAL_DIMENSION = { width: 320, height: 220 };

const ChartContext = React.createContext(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error('useChart must be used within a <ChartContainer />');
  }
  return context;
}

function ChartStyle({ id, config }) {
  const colorConfig = Object.entries(config || {}).filter(
    ([, itemConfig]) => itemConfig?.theme || itemConfig?.color
  );

  if (!colorConfig.length) {
    return null;
  }

  const cssText = Object.entries(THEMES)
    .map(
      ([theme, prefix]) => `
${prefix ? `${prefix} ` : ''}[data-chart="${id}"] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color = itemConfig.theme?.[theme] ?? itemConfig.color;
    return color ? `  --color-${key}: ${color};` : null;
  })
  .filter(Boolean)
  .join('\n')}
}
`
    )
    .join('\n');

  return <style dangerouslySetInnerHTML={{ __html: cssText }} />;
}

function ChartContainer({
  id,
  className = '',
  children,
  config,
  initialDimension = INITIAL_DIMENSION,
  ...props
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={`shadcn-chart-container${className ? ` ${className}` : ''}`}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={initialDimension}
        >
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

const ChartTooltip = RechartsPrimitive.Tooltip;

function getPayloadConfigFromPayload(config, payload, key) {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }

  const payloadPayload =
    'payload' in payload && typeof payload.payload === 'object' && payload.payload !== null
      ? payload.payload
      : undefined;

  let configLabelKey = key;

  if (key in payload && typeof payload[key] === 'string') {
    configLabelKey = payload[key];
  } else if (payloadPayload && key in payloadPayload && typeof payloadPayload[key] === 'string') {
    configLabelKey = payloadPayload[key];
  }

  return configLabelKey in config ? config[configLabelKey] : config[key];
}

function ChartTooltipContent({
  active,
  payload,
  className = '',
  indicator = 'dot',
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName = '',
  formatter,
  color,
  nameKey,
  labelKey,
  valueSuffix = '',
}) {
  const { config } = useChart();

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) {
      return null;
    }

    const [item] = payload;
    const key = `${labelKey ?? item?.dataKey ?? item?.name ?? 'value'}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value =
      !labelKey && typeof label === 'string'
        ? (config[label]?.label ?? label)
        : itemConfig?.label;

    if (labelFormatter) {
      return (
        <div className={`shadcn-chart-tooltip-label${labelClassName ? ` ${labelClassName}` : ''}`}>
          {labelFormatter(value, payload)}
        </div>
      );
    }

    if (!value) {
      return null;
    }

    return (
      <div className={`shadcn-chart-tooltip-label${labelClassName ? ` ${labelClassName}` : ''}`}>
        {value}
      </div>
    );
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

  if (!active || !payload?.length) {
    return null;
  }

  const nestLabel = payload.length === 1 && indicator !== 'dot';

  return (
    <div className={`shadcn-chart-tooltip${className ? ` ${className}` : ''}`}>
      {!nestLabel ? tooltipLabel : null}
      <div className="shadcn-chart-tooltip-list">
        {payload
          .filter((item) => item.type !== 'none')
          .map((item, index) => {
            const key = `${nameKey ?? item.name ?? item.dataKey ?? 'value'}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const indicatorColor = color ?? item.payload?.fill ?? item.color;
            const IndicatorIcon = itemConfig?.icon;

            return (
              <div
                key={item.dataKey || item.name || index}
                className={`shadcn-chart-tooltip-item${
                  indicator !== 'dot' ? ' shadcn-chart-tooltip-item--align-start' : ''
                }`}
              >
                {formatter && item?.value !== undefined && item.name ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    {IndicatorIcon ? (
                      <IndicatorIcon />
                    ) : (
                      !hideIndicator && (
                        <div
                          className={`shadcn-chart-tooltip-indicator shadcn-chart-tooltip-indicator--${indicator}`}
                          style={{
                            '--color-bg': indicatorColor,
                            '--color-border': indicatorColor,
                          }}
                        />
                      )
                    )}
                    <div
                      className={`shadcn-chart-tooltip-row${
                        nestLabel ? ' shadcn-chart-tooltip-row--nested' : ''
                      }`}
                    >
                      <div>
                        {nestLabel ? tooltipLabel : null}
                        <span className="shadcn-chart-tooltip-name">
                          {itemConfig?.label ?? item.name}
                        </span>
                      </div>
                      {item.value != null && (
                        <span className="shadcn-chart-tooltip-value">
                          {typeof item.value === 'number'
                            ? item.value.toLocaleString()
                            : String(item.value)}
                          {valueSuffix}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

const ChartLegend = RechartsPrimitive.Legend;

function ChartLegendContent({
  className = '',
  hideIcon = false,
  payload,
  verticalAlign = 'bottom',
  nameKey,
}) {
  const { config } = useChart();

  if (!payload?.length) {
    return null;
  }

  return (
    <div
      className={`shadcn-chart-legend shadcn-chart-legend--${verticalAlign}${
        className ? ` ${className}` : ''
      }`}
    >
      {payload
        .filter((item) => item.type !== 'none')
        .map((item, index) => {
          const key = `${nameKey ?? item.dataKey ?? 'value'}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);
          const LegendIcon = itemConfig?.icon;

          return (
            <div key={item.value || index} className="shadcn-chart-legend-item">
              {LegendIcon && !hideIcon ? (
                <LegendIcon />
              ) : (
                <div
                  className="shadcn-chart-legend-swatch"
                  style={{ backgroundColor: item.color }}
                />
              )}
              <span>{itemConfig?.label ?? item.value}</span>
            </div>
          );
        })}
    </div>
  );
}

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
};
