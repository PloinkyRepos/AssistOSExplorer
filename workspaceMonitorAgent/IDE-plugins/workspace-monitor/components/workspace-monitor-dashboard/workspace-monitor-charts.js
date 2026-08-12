const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const CHART_WIDTH = 1000;
const CHART_HEIGHT = 100;
const CHART_INSET = 2;
const HISTORY_PIXELS_PER_MINUTE = 8;
const MAX_HISTORY_CHART_WIDTH = 250_000;

function buildSmoothChartPath(samples, scale) {
  const usableWidth = CHART_WIDTH - (CHART_INSET * 2);
  const usableHeight = CHART_HEIGHT - (CHART_INSET * 2);
  const points = samples.map((sample, index) => ({
    x: CHART_INSET + (samples.length === 1 ? usableWidth : (index / (samples.length - 1)) * usableWidth),
    y: CHART_INSET + ((scale - Math.min(scale, Math.max(0, sample))) / scale) * usableHeight
  }));
  if (!points.length) return '';
  if (points.length === 1) return `M ${CHART_INSET} ${points[0].y} L ${CHART_WIDTH - CHART_INSET} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const controlX = (previous.x + current.x) / 2;
    path += ` C ${controlX} ${previous.y}, ${controlX} ${current.y}, ${current.x} ${current.y}`;
  }
  return path;
}

function appendChartSeries(svg, samples, scale, name) {
  const linePath = buildSmoothChartPath(samples, scale);
  const area = document.createElementNS(SVG_NAMESPACE, 'path');
  area.setAttribute('class', `chart-area chart-area-${name}`);
  area.setAttribute('d', linePath ? `${linePath} L ${CHART_WIDTH - CHART_INSET} ${CHART_HEIGHT - CHART_INSET} L ${CHART_INSET} ${CHART_HEIGHT - CHART_INSET} Z` : '');
  const line = document.createElementNS(SVG_NAMESPACE, 'path');
  line.setAttribute('class', `chart-line chart-line-${name}`);
  line.setAttribute('d', linePath);
  svg.append(area, line);
}

function formatTimelineLabel(timestamp, duration, includeSeconds = false) {
  const options = duration >= 24 * 60 * 60 * 1000
    ? { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit', ...(includeSeconds ? { second: '2-digit' } : {}) };
  return new Date(timestamp).toLocaleString([], options);
}

function appendChartTimeline(host, from, to, { includeSeconds = false, contentWidth = null } = {}) {
  if (!host || !Number.isFinite(from) || !Number.isFinite(to)) return;
  const timeline = document.createElement('div');
  timeline.className = 'chart-timeline';
  timeline.setAttribute('aria-label', 'Chart timeline');
  const duration = Math.max(0, to - from);
  if (Number.isFinite(contentWidth) && contentWidth > CHART_WIDTH && duration > 0) {
    timeline.classList.add('chart-timeline-scrollable');
    timeline.style.width = `${contentWidth}px`;
    const minuteWidth = contentWidth / (duration / 60_000);
    timeline.style.setProperty('--minute-width', `${minuteWidth}px`);
    timeline.style.setProperty('--minute-tick-width', `${Math.min(1, minuteWidth / 3)}px`);
    const labelSteps = [1, 2, 5, 10, 15, 30, 60, 120, 360, 720, 1440, 2880, 10080];
    const labelStepMinutes = labelSteps.find((minutes) => minutes * minuteWidth >= 110) || labelSteps.at(-1);
    const labelStepMs = labelStepMinutes * 60_000;
    const first = Math.ceil(from / labelStepMs) * labelStepMs;
    for (let timestamp = first; timestamp <= to; timestamp += labelStepMs) {
      const label = document.createElement('time');
      label.dateTime = new Date(timestamp).toISOString();
      label.textContent = formatTimelineLabel(timestamp, duration);
      label.style.left = `${((timestamp - from) / duration) * 100}%`;
      timeline.append(label);
    }
    host.append(timeline);
    return;
  }
  const timestamps = duration === 0 ? [from] : [from, from + duration / 2, to];
  for (const timestamp of timestamps) {
    const label = document.createElement('time');
    label.dateTime = new Date(timestamp).toISOString();
    label.textContent = formatTimelineLabel(timestamp, duration, includeSeconds);
    timeline.append(label);
  }
  host.append(timeline);
}

function appendTimeAxis(svg, width = CHART_WIDTH) {
  const y = CHART_HEIGHT - CHART_INSET;
  const axis = document.createElementNS(SVG_NAMESPACE, 'line');
  axis.setAttribute('class', 'chart-time-axis');
  axis.setAttribute('x1', String(CHART_INSET));
  axis.setAttribute('x2', String(width - CHART_INSET));
  axis.setAttribute('y1', String(y));
  axis.setAttribute('y2', String(y));
  svg.append(axis);
  for (const x of [CHART_INSET, width / 2, width - CHART_INSET]) {
    const tick = document.createElementNS(SVG_NAMESPACE, 'line');
    tick.setAttribute('class', 'chart-time-tick');
    tick.setAttribute('x1', String(x));
    tick.setAttribute('x2', String(x));
    tick.setAttribute('y1', String(y - 4));
    tick.setAttribute('y2', String(y));
    svg.append(tick);
  }
}

function historyChartPoints(points, scale, range) {
  return points.flatMap(([timestamp, rawValue]) => {
    const value = Number(rawValue);
    if (!Number.isFinite(timestamp) || !Number.isFinite(value)) return [];
    return [{
      x: CHART_INSET + ((timestamp - range.from) / (range.to - range.from)) * (range.width - CHART_INSET * 2),
      y: CHART_INSET + ((scale - Math.min(scale, Math.max(0, value))) / scale) * (CHART_HEIGHT - CHART_INSET * 2)
    }];
  });
}

function buildHistorySmoothPath(points, scale, range) {
  const plotted = historyChartPoints(points, scale, range);
  if (!plotted.length) return { line: '', area: '' };
  if (plotted.length === 1) return { line: `M ${plotted[0].x} ${plotted[0].y}`, area: '' };
  let line = `M ${plotted[0].x} ${plotted[0].y}`;
  for (let index = 1; index < plotted.length; index += 1) {
    const previous = plotted[index - 1];
    const current = plotted[index];
    const controlX = (previous.x + current.x) / 2;
    line += ` C ${controlX} ${previous.y}, ${controlX} ${current.y}, ${current.x} ${current.y}`;
  }
  const first = plotted[0];
  const last = plotted.at(-1);
  return { line, area: `${line} L ${last.x} ${CHART_HEIGHT - CHART_INSET} L ${first.x} ${CHART_HEIGHT - CHART_INSET} Z` };
}

function thresholdAt(thresholds, timestamp, fallback) {
  let value = Number(fallback);
  for (const [thresholdTimestamp, rawThreshold] of thresholds) {
    if (thresholdTimestamp > timestamp) break;
    if (Number.isFinite(rawThreshold)) value = Number(rawThreshold);
  }
  return value;
}

function aboveThresholdSegments(points, thresholds, fallbackThreshold) {
  const compared = points
    .filter(([timestamp, value]) => Number.isFinite(timestamp) && Number.isFinite(value))
    .map(([timestamp, value]) => [timestamp, value, thresholdAt(thresholds, timestamp, fallbackThreshold)]);
  const segments = [];
  let active = [];
  const crossing = (left, right) => {
    const leftDifference = left[1] - left[2];
    const rightDifference = right[1] - right[2];
    const ratio = leftDifference / (leftDifference - rightDifference);
    return [left[0] + (right[0] - left[0]) * ratio, left[1] + (right[1] - left[1]) * ratio];
  };
  for (let index = 0; index < compared.length; index += 1) {
    const current = compared[index];
    const previous = compared[index - 1];
    const currentAbove = current[1] > current[2];
    const previousAbove = previous?.[1] > previous?.[2];
    const currentPoint = [current[0], current[1]];
    if (currentAbove && !previousAbove) active = previous ? [crossing(previous, current), currentPoint] : [currentPoint];
    else if (currentAbove) active.push(currentPoint);
    else if (previousAbove) {
      active.push(crossing(previous, current));
      segments.push(active);
      active = [];
    }
  }
  if (active.length) segments.push(active);
  return segments;
}

function appendHistorySeries(svg, points, scale, range, className, thresholds = null, fallbackThreshold = 0) {
  const paths = buildHistorySmoothPath(points, scale, range);
  if (!paths.line) return;
  if (paths.area) {
    const area = document.createElementNS(SVG_NAMESPACE, 'path');
    area.setAttribute('class', `history-area ${className}`);
    area.setAttribute('d', paths.area);
    svg.append(area);
  }
  const line = document.createElementNS(SVG_NAMESPACE, 'path');
  line.setAttribute('class', `history-line ${className}`);
  line.setAttribute('d', paths.line);
  svg.append(line);
  if (!thresholds) return;
  for (const segment of aboveThresholdSegments(points, thresholds, fallbackThreshold)) {
    const spikePath = buildHistorySmoothPath(segment, scale, range).line;
    if (!spikePath) continue;
    const spike = document.createElementNS(SVG_NAMESPACE, 'path');
    spike.setAttribute('class', `history-spike ${className}`);
    spike.setAttribute('d', spikePath);
    svg.append(spike);
  }
}

function appendRecordedThreshold(svg, thresholds, fallbackThreshold, scale, range, className, stepMs, unit) {
  const points = thresholds.length ? thresholds : [[range.from, fallbackThreshold], [range.to, fallbackThreshold]];
  let path = '';
  let previous = null;
  let previousLabelValue = null;
  const labels = [];
  for (const [timestamp, rawValue] of points) {
    const value = Number(rawValue);
    if (!Number.isFinite(timestamp) || !Number.isFinite(value)) continue;
    const x = CHART_INSET + ((timestamp - range.from) / (range.to - range.from)) * (range.width - CHART_INSET * 2);
    const y = CHART_INSET + ((scale - Math.min(scale, Math.max(0, value))) / scale) * (CHART_HEIGHT - CHART_INSET * 2);
    const disconnected = !previous || timestamp - previous.timestamp > stepMs * 1.5;
    if (disconnected) path += `M ${x} ${y} `;
    else if (value !== previous.value) path += `L ${x} ${previous.y} L ${x} ${y} `;
    else path += `L ${x} ${y} `;
    if (previousLabelValue === null || value !== previousLabelValue) {
      const label = document.createElementNS(SVG_NAMESPACE, 'text');
      label.setAttribute('class', `history-threshold-label ${className}`);
      label.setAttribute('x', String(x + 4));
      label.setAttribute('y', String(Math.max(10, y - 3)));
      label.textContent = `${value.toFixed(unit === '%' ? 0 : 2)}${unit}`;
      labels.push(label);
      previousLabelValue = value;
    }
    previous = { timestamp, value, y };
  }
  if (!path) return;
  const line = document.createElementNS(SVG_NAMESPACE, 'path');
  line.setAttribute('class', `history-line history-threshold ${className}`);
  line.setAttribute('d', path.trim());
  svg.append(line, ...labels);
}

function appendHistoryYAxis(host, scale, unit) {
  const card = host.closest('.history-chart-card');
  if (!card) return;
  card.querySelector(':scope > .history-y-axis')?.remove();
  const axis = document.createElement('div');
  axis.className = 'history-y-axis';
  axis.setAttribute('aria-label', `Vertical scale, 0 to ${scale}${unit}`);
  for (let index = 0; index <= 4; index += 1) {
    const value = scale * (1 - index / 4);
    const label = document.createElement('span');
    label.style.top = `${index * 25}%`;
    label.textContent = `${value.toFixed(unit === '%' ? 0 : 2)}${unit}`;
    axis.append(label);
  }
  card.insertBefore(axis, host);
}

function appendHistoryPoints(svg, points, thresholds, fallbackThreshold, scale, range, className, label, unit, onSelect) {
  if (!points.length || scale <= 0 || range.to <= range.from) return;
  for (const [timestamp, rawValue] of points) {
    const value = Number(rawValue);
    if (!Number.isFinite(timestamp) || !Number.isFinite(value)) continue;
    const plotted = historyChartPoints([[timestamp, value]], scale, range)[0];
    const point = document.createElementNS(SVG_NAMESPACE, 'circle');
    const formattedValue = `${value.toFixed(unit === '%' ? 1 : 2)}${unit}`;
    const hasThreshold = Array.isArray(thresholds);
    const threshold = hasThreshold ? thresholdAt(thresholds, timestamp, fallbackThreshold) : null;
    const formattedThreshold = hasThreshold ? `${threshold.toFixed(unit === '%' ? 1 : 2)}${unit}` : null;
    const formattedTime = new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' });
    point.setAttribute('class', `history-point ${className}`);
    point.setAttribute('cx', String(plotted.x));
    point.setAttribute('cy', String(plotted.y));
    point.setAttribute('r', '4');
    point.setAttribute('tabindex', '0');
    point.setAttribute('role', 'button');
    point.setAttribute('aria-label', hasThreshold
      ? `${label}, ${formattedValue}, threshold ${formattedThreshold}, ${formattedTime}`
      : `${label}, ${formattedValue}, ${formattedTime}`);
    const select = () => onSelect({ label, formattedValue, formattedThreshold, formattedTime, exceeded: hasThreshold && value > threshold });
    point.addEventListener('click', select);
    point.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      select();
    });
    svg.append(point);
  }
}

export function renderLiveCpuChart(host, series, titleText) {
  if (!host || !series?.length || series.some((item) => !item.samples.length)) return;
  const scale = Math.max(100, ...series.flatMap((item) => item.samples));
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  appendTimeAxis(svg);
  const title = document.createElementNS(SVG_NAMESPACE, 'title');
  title.textContent = titleText;
  svg.append(title);
  for (const item of series) appendChartSeries(svg, item.samples, scale, item.name);
  host.replaceChildren(svg);
}

export function appendLiveTimeline(host, from, to) {
  appendChartTimeline(host, from, to, { includeSeconds: true });
}

export function renderHistoryChart(host, definitions, { from, to, stepMs, transform, minimumScale, unit }) {
  if (!host) return;
  const transformed = definitions.map((definition) => ({
    ...definition,
    values: (definition.data?.values || []).map(([timestamp, value]) => [timestamp, transform(value)]),
    thresholds: (definition.data?.thresholds || []).map(([timestamp, value]) => [timestamp, transform(value)]),
    valueThresholds: (definition.data?.valueThresholds || []).map(([timestamp, value]) => [timestamp, transform(value)]),
    threshold: Number(definition.threshold)
  }));
  const chartWidth = Math.min(MAX_HISTORY_CHART_WIDTH, Math.max(CHART_WIDTH, Math.ceil((to - from) / 60_000) * HISTORY_PIXELS_PER_MINUTE));
  const range = { from, to, width: chartWidth };
  const scale = Math.max(minimumScale, ...transformed.flatMap((item) => item.showThreshold === false
    ? item.values.map(([, value]) => value)
    : [item.threshold, ...item.values.map(([, value]) => value), ...item.thresholds.map(([, value]) => value), ...item.valueThresholds.map(([, value]) => value)]));
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', `0 0 ${chartWidth} ${CHART_HEIGHT}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.style.width = `${chartWidth}px`;
  appendTimeAxis(svg, chartWidth);
  const showPointDetails = ({ label, formattedValue, formattedThreshold, formattedTime, exceeded }) => {
    let details = host.querySelector('.chart-point-details');
    if (!details) {
      details = document.createElement('output');
      details.className = 'chart-point-details';
      details.setAttribute('aria-live', 'polite');
      host.append(details);
    }
    details.style.left = `${host.scrollLeft + 8}px`;
    details.textContent = formattedThreshold
      ? `${label}: ${formattedValue} · threshold ${formattedThreshold}${exceeded ? ' · spike' : ''} · ${formattedTime}`
      : `${label}: ${formattedValue} · ${formattedTime}`;
  };
  for (const item of transformed) {
    const showThreshold = item.showThreshold !== false;
    const comparisonThresholds = showThreshold ? (item.valueThresholds.length ? item.valueThresholds : item.thresholds) : null;
    if (showThreshold) appendRecordedThreshold(svg, item.thresholds, item.threshold, scale, range, item.className, stepMs, unit);
    appendHistorySeries(svg, item.values, scale, range, item.className, comparisonThresholds, item.threshold);
    appendHistoryPoints(svg, item.values, comparisonThresholds, item.threshold, scale, range, item.className, item.label, unit, showPointDetails);
  }
  host.replaceChildren(svg);
  appendChartTimeline(host, from, to, { contentWidth: chartWidth });
  appendHistoryYAxis(host, scale, unit);
  const latestTimestamp = Math.max(from, ...transformed.flatMap((item) => item.values.map(([timestamp]) => timestamp)));
  requestAnimationFrame(() => {
    const latestX = ((latestTimestamp - from) / (to - from)) * chartWidth;
    host.scrollLeft = Math.max(0, latestX - host.clientWidth * 0.75);
  });
}
