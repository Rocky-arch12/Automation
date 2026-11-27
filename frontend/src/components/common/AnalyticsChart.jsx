import { useEffect, useRef } from 'react';
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  DoughnutController,
  ArcElement,
  BarController,
  BarElement,
  Tooltip,
  Legend
);

Chart.defaults.color = '#94a3b8';
Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(15, 21, 35, 0.95)';
Chart.defaults.plugins.tooltip.borderColor = 'rgba(255, 255, 255, 0.12)';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.legend.labels.boxWidth = 12;
Chart.defaults.plugins.legend.labels.padding = 12;

export function AnalyticsChart({ id, type, data, options }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const typeRef = useRef(type);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    if (chartRef.current && typeRef.current !== type) {
      chartRef.current.destroy();
      chartRef.current = null;
    }
    typeRef.current = type;

    if (!chartRef.current) {
      chartRef.current = new Chart(canvas.getContext('2d'), {
        type,
        data,
        options,
      });
    } else {
      chartRef.current.data = data;
      chartRef.current.options = options;
      chartRef.current.update();
    }
  }, [type, data, options]);

  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, []);

  return <canvas id={id} ref={canvasRef} />;
}
