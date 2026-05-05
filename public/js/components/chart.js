// FortunaPanel - Shared Chart Component

/**
 * Read a CSS custom property from :root and wrap it as hsl().
 * Falls back to the provided default if the property is empty.
 * @param {string} varName - e.g. '--chart-1'
 * @param {string} fallback - fallback hex color
 */
export function getCSSColor(varName, fallback = '#888') {
    const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return val ? `hsl(${val})` : fallback;
}

/**
 * Draw a line/area chart on a canvas element.
 * @param {string} canvasId - Canvas element ID
 * @param {number[]} data - Array of values
 * @param {string} color - Any valid CSS color string (hex, hsl, rgb, etc.)
 * @param {object} options - Optional settings
 * @param {number} options.maxValue - Max value for Y axis scaling (default: 100)
 * @param {boolean} options.showDot - Show current value dot (default: true)
 * @param {number} options.fillAlpha - Fill opacity 0-1 (default: 0.09)
 */
export function drawChart(canvasId, data, color, options = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const { maxValue = 100, showDot = true, fillAlpha = 0.09 } = options;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const padding = { top: 4, bottom: 4, left: 0, right: 0 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    ctx.clearRect(0, 0, w, h);

    if (data.length < 2) return;

    const max = maxValue || Math.max(1, ...data);
    const step = chartW / (data.length - 1);

    // Area fill (uses globalAlpha for universal color format support)
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top + chartH);
    for (let i = 0; i < data.length; i++) {
        const x = padding.left + i * step;
        const y = padding.top + chartH - (data[i] / max) * chartH;
        ctx.lineTo(x, y);
    }
    ctx.lineTo(padding.left + (data.length - 1) * step, padding.top + chartH);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'transparent');
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Line
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
        const x = padding.left + i * step;
        const y = padding.top + chartH - (data[i] / max) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Current value dot
    if (showDot && data.length > 0) {
        const lastX = padding.left + (data.length - 1) * step;
        const lastY = padding.top + chartH - (data[data.length - 1] / max) * chartH;
        ctx.beginPath();
        ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
    }
}
