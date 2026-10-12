// price_chart_view_printer.js
// Renders selected time and numeric columns into a zoomable SVG line chart.
// Bridges selected time-series data and the dataset view rendering system.
// Exists to provide a dependency-free general chart for typed time and numbers.

import {
    extract_price_chart_points,
    getChartAxisChoices,
    resolveChartAxes,
    chartAxesToParams,
    format_price_chart_time,
    format_price_chart_value,
} from "./price_chart_data_reader.js";

import { getParams, updateURL } from '../../navigation/nav_engine/query_params.js';
import { getTranslationForKey } from '../../lang/component_language_dictionary.js';
import { getLanguageWithBrowserFallback } from '../../state_stores/lang_preference_reader.js';
import { chartFallback } from './chart_copy.js';

function copy(key) {
    return getTranslationForKey(key, { fallback: chartFallback(key, getLanguageWithBrowserFallback()) });
}

function translateElement(element, key) {
    element.dataset.langKey = key;
    element.textContent = copy(key);
    return element;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SVG_WIDTH = 920;
const SVG_HEIGHT = 420;
const PLOT_PADDING = {
    top: 26,
    right: 28,
    bottom: 52,
    left: 76,
};
const GRID_LINE_COUNT = 4;
const ZOOM_IN_FACTOR = 0.78;
const ZOOM_OUT_FACTOR = 1.28;
const MIN_RANGE_RATIO = 0.015;

// Creates an SVG element with optional attributes.
function createSvgElement(tagName, attributes = {}) {
    const element = document.createElementNS(SVG_NAMESPACE, tagName);
    Object.entries(attributes).forEach(([name, value]) => {
        element.setAttribute(name, String(value));
    });
    return element;
}

// Creates one translatable button for the chart toolbar.
function createToolbarButton(label, langKey, ariaLabel, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("price-chart-view__toolbar-button");
    button.dataset.langKey = langKey;
    button.textContent = label;
    button.setAttribute("aria-label", ariaLabel);
    button.title = ariaLabel;
    const helpKey = label === '+' ? 'chart_zoom_in' : label === '-' ? 'chart_zoom_out' : langKey;
    button.dataset.ariaLabelLangKey = helpKey;
    button.dataset.titleLangKey = helpKey;
    button.addEventListener("click", onClick);
    return button;
}

// Keeps a time range inside the full data domain while respecting a minimum span.
function clampVisibleRange(startTime, endTime, domainStart, domainEnd) {
    const domainSpan = Math.max(1, domainEnd - domainStart);
    const minimumSpan = Math.max(60000, domainSpan * MIN_RANGE_RATIO);
    let nextStart = startTime;
    let nextEnd = endTime;

    if (nextEnd - nextStart < minimumSpan) {
        const center = (nextStart + nextEnd) / 2;
        nextStart = center - (minimumSpan / 2);
        nextEnd = center + (minimumSpan / 2);
    }
    if (nextStart < domainStart) {
        nextEnd += domainStart - nextStart;
        nextStart = domainStart;
    }
    if (nextEnd > domainEnd) {
        nextStart -= nextEnd - domainEnd;
        nextEnd = domainEnd;
    }

    return {
        startTime: Math.max(domainStart, nextStart),
        endTime: Math.min(domainEnd, nextEnd),
    };
}

// Applies zoom around a given x-axis anchor.
function zoomRange(state, factor, anchorRatio = 0.5) {
    const currentSpan = state.visibleEndTime - state.visibleStartTime;
    const anchorTime = state.visibleStartTime + currentSpan * anchorRatio;
    const nextSpan = currentSpan * factor;
    const nextStart = anchorTime - nextSpan * anchorRatio;
    const nextEnd = nextStart + nextSpan;
    const clampedRange = clampVisibleRange(
        nextStart,
        nextEnd,
        state.domainStartTime,
        state.domainEndTime
    );
    state.visibleStartTime = clampedRange.startTime;
    state.visibleEndTime = clampedRange.endTime;
}

// Resolves visible points for the current time window.
function getVisiblePoints(points, state) {
    return points.filter((point) => (
        point.time >= state.visibleStartTime
        && point.time <= state.visibleEndTime
    ));
}

// Creates a text label inside the chart SVG.
function createSvgText(text, x, y, className, anchor = "middle") {
    const label = createSvgElement("text", {
        x,
        y,
        "text-anchor": anchor,
        class: className,
    });
    label.textContent = text;
    return label;
}

// Converts chart values into SVG coordinates.
function createScale(state, visiblePoints) {
    const prices = visiblePoints.map((point) => point.price);
    const rawMinPrice = Math.min(...prices);
    const rawMaxPrice = Math.max(...prices);
    const pricePadding = rawMinPrice === rawMaxPrice
        ? Math.max(1, rawMinPrice * 0.05)
        : (rawMaxPrice - rawMinPrice) * 0.08;
    const minPrice = rawMinPrice - pricePadding;
    const maxPrice = rawMaxPrice + pricePadding;
    const plotWidth = SVG_WIDTH - PLOT_PADDING.left - PLOT_PADDING.right;
    const plotHeight = SVG_HEIGHT - PLOT_PADDING.top - PLOT_PADDING.bottom;
    const timeSpan = Math.max(1, state.visibleEndTime - state.visibleStartTime);
    const priceSpan = Math.max(1, maxPrice - minPrice);

    return {
        minPrice,
        maxPrice,
        plotWidth,
        plotHeight,
        xForTime: (time) => PLOT_PADDING.left + ((time - state.visibleStartTime) / timeSpan) * plotWidth,
        yForPrice: (price) => PLOT_PADDING.top + (1 - ((price - minPrice) / priceSpan)) * plotHeight,
    };
}

// Builds grid lines and axis labels for the SVG chart.
function appendGridAndAxes(svg, state, scale) {
    const plotBottom = PLOT_PADDING.top + scale.plotHeight;
    const plotRight = PLOT_PADDING.left + scale.plotWidth;

    for (let index = 0; index <= GRID_LINE_COUNT; index += 1) {
        const ratio = index / GRID_LINE_COUNT;
        const y = PLOT_PADDING.top + ratio * scale.plotHeight;
        const price = scale.maxPrice - ratio * (scale.maxPrice - scale.minPrice);
        svg.appendChild(createSvgElement("line", {
            x1: PLOT_PADDING.left,
            y1: y,
            x2: plotRight,
            y2: y,
            class: "price-chart-view__grid-line",
        }));
        svg.appendChild(createSvgText(
            format_price_chart_value(price),
            PLOT_PADDING.left - 12,
            y + 4,
            "price-chart-view__axis-label price-chart-view__axis-label--price",
            "end"
        ));
    }

    svg.appendChild(createSvgElement("line", {
        x1: PLOT_PADDING.left,
        y1: plotBottom,
        x2: plotRight,
        y2: plotBottom,
        class: "price-chart-view__axis-line",
    }));
    svg.appendChild(createSvgElement("line", {
        x1: PLOT_PADDING.left,
        y1: PLOT_PADDING.top,
        x2: PLOT_PADDING.left,
        y2: plotBottom,
        class: "price-chart-view__axis-line",
    }));

    svg.appendChild(createSvgText(
        format_price_chart_time(state.visibleStartTime, state.clockOnly),
        PLOT_PADDING.left,
        plotBottom + 34,
        "price-chart-view__axis-label",
        "start"
    ));
    svg.appendChild(createSvgText(
        format_price_chart_time(state.visibleEndTime, state.clockOnly),
        plotRight,
        plotBottom + 34,
        "price-chart-view__axis-label",
        "end"
    ));
}

// Builds the chart path from visible points.
function createLinePath(visiblePoints, scale) {
    const commands = visiblePoints.map((point, index) => {
        const command = index === 0 ? "M" : "L";
        return `${command} ${scale.xForTime(point.time).toFixed(2)} ${scale.yForPrice(point.price).toFixed(2)}`;
    });
    return createSvgElement("path", {
        d: commands.join(" "),
        class: "price-chart-view__line",
        fill: "none",
    });
}

// Appends small point markers so sparse demo data remains inspectable.
function appendPointMarkers(svg, visiblePoints, scale, clockOnly) {
    visiblePoints.forEach((point) => {
        const marker = createSvgElement("circle", {
            cx: scale.xForTime(point.time).toFixed(2),
            cy: scale.yForPrice(point.price).toFixed(2),
            r: 3.5,
            class: "price-chart-view__point",
        });
        marker.appendChild(createSvgElement("title"));
        marker.querySelector("title").textContent = `${format_price_chart_time(point.time, clockOnly)}: ${format_price_chart_value(point.price)}`;
        svg.appendChild(marker);
    });
}

// Creates the empty or unsupported state for non-price datasets.
function createNoticeElement(titleKey, bodyKey) {
    const notice = document.createElement("div");
    notice.classList.add("price-chart-view__notice");

    const title = document.createElement("h3");
    translateElement(title, titleKey);

    const body = document.createElement("p");
    translateElement(body, bodyKey);

    notice.append(title, body);
    return notice;
}

// Updates the visible status strip below the toolbar.
function updateStatusElement(statusElement, state, visibleCount, totalCount, timeColumn, priceColumn) {
    statusElement.replaceChildren();

    const count = document.createElement("span");
    count.classList.add("price-chart-view__status-item");
    count.textContent = `${visibleCount}/${totalCount}`;

    const range = document.createElement("span");
    range.classList.add("price-chart-view__status-item");
    range.textContent = `${format_price_chart_time(state.visibleStartTime, state.clockOnly)} - ${format_price_chart_time(state.visibleEndTime, state.clockOnly)}`;

    const columns = document.createElement("span");
    columns.classList.add("price-chart-view__status-item", "price-chart-view__status-item--muted");
    const x = document.createElement('span');
    const y = document.createElement('span');
    x.dataset.langKey = timeColumn;
    y.dataset.langKey = priceColumn;
    x.textContent = getTranslationForKey(timeColumn, { fallback: timeColumn });
    y.textContent = getTranslationForKey(priceColumn, { fallback: priceColumn });
    columns.append(x, ' / ', y);

    statusElement.append(count, range, columns);
}

// Renders the SVG chart for the current state.
function renderChart(plotHost, statusElement, points, state, timeColumn, priceColumn) {
    plotHost.replaceChildren();
    const visiblePoints = getVisiblePoints(points, state);
    updateStatusElement(statusElement, state, visiblePoints.length, points.length, timeColumn, priceColumn);

    if (visiblePoints.length === 0) {
        plotHost.appendChild(createNoticeElement(
            "chart_no_visible_data_title", "chart_no_visible_data_body"
        ));
        return;
    }

    const svg = createSvgElement("svg", {
        class: "price-chart-view__svg",
        viewBox: `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`,
        role: "img",
        "aria-label": copy("view_chart"),
        preserveAspectRatio: "xMidYMid meet",
    });
    const scale = createScale(state, visiblePoints);
    svg.dataset.ariaLabelLangKey = 'view_chart';
    appendGridAndAxes(svg, state, scale);
    if (visiblePoints.length > 1) {
        svg.appendChild(createLinePath(visiblePoints, scale));
    }
    appendPointMarkers(svg, visiblePoints, scale, state.clockOnly);
    plotHost.appendChild(svg);
}

// Wires Alt+wheel zooming to the plot host.
function attachWheelZoom(plotHost, state, render) {
    plotHost.addEventListener("wheel", (event) => {
        if (!event.altKey || !Number.isFinite(state.domainStartTime) || !Number.isFinite(state.domainEndTime)) {
            return;
        }
        event.preventDefault();
        const rect = plotHost.getBoundingClientRect();
        const anchorRatio = rect.width > 0
            ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
            : 0.5;
        zoomRange(state, event.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR, anchorRatio);
        render();
    }, { passive: false });
}

/**
 * Creates the general chart under its existing price_chart compatibility key.
 * Operates between the dataset renderer and selected numeric-series rows.
 * Exists as the integration point for the reusable dataset view registry.
 */
export function create_price_chart_view(table_name, columns, data, data_types = {}, options = {}) {
    const choices = getChartAxisChoices(columns, data_types);
    let axes = resolveChartAxes(columns, data_types, options.params || getParams(table_name), options.savedColumns);
    let currentRows = Array.isArray(data) ? data : [];
    let extraction = extract_price_chart_points(columns, currentRows, data_types, axes);
    const root = document.createElement("section");
    root.classList.add("price-chart-view");
    root.dataset.datasetName = table_name;
    root.dataset.testid = "price-chart-view";
    root.dataset.datasetRowCommitter = 'price-chart';

    if (!axes.timeColumn || !axes.priceColumn) {
        root.appendChild(createNoticeElement("chart_unavailable_title", "chart_unavailable_body"));
        return root;
    }

    const state = {};
    const updateDomain = (reset = false) => {
        if (!extraction.points.length) {
            Object.assign(state, { domainStartTime: undefined, domainEndTime: undefined,
                visibleStartTime: undefined, visibleEndTime: undefined });
            return;
        }
        const followedDomain = state.visibleStartTime === state.domainStartTime
            && state.visibleEndTime === state.domainEndTime;
        state.domainStartTime = extraction.points[0].time;
        state.domainEndTime = extraction.points.at(-1).time;
        if (reset || followedDomain || state.visibleStartTime === undefined) {
            state.visibleStartTime = state.domainStartTime;
            state.visibleEndTime = state.domainEndTime;
        } else {
            state.visibleStartTime = Math.max(state.domainStartTime, state.visibleStartTime);
            state.visibleEndTime = Math.min(state.domainEndTime, state.visibleEndTime);
        }
    };
    const toolbar = document.createElement("div");
    toolbar.classList.add("price-chart-view__toolbar");
    const title = translateElement(document.createElement("h3"), "view_chart");
    title.classList.add("price-chart-view__title");
    const actions = document.createElement("div");
    actions.classList.add("price-chart-view__toolbar-actions");
    const status = document.createElement("div");
    status.classList.add("price-chart-view__status");
    const plotHost = document.createElement("div");
    plotHost.classList.add("price-chart-view__plot-host");
    plotHost.dataset.testid = "price-chart-plot";
    plotHost.title = copy("chart_wheel_help");
    plotHost.dataset.titleLangKey = 'chart_wheel_help';
    const render = () => {
        root.dataset.chartX = axes.timeColumn;
        root.dataset.chartY = axes.priceColumn;
        const type = data_types[axes.timeColumn];
        state.clockOnly = /^(time(?:\(|\s|$)|timetz$)/i.test(typeof type === 'string' ? type : type?.data_type || '');
        if (!extraction.points.length) {
            plotHost.replaceChildren(createNoticeElement("chart_no_data_title", "chart_no_data_body"));
            status.replaceChildren();
            return;
        }
        renderChart(plotHost, status, extraction.points, state, axes.timeColumn, axes.priceColumn);
    };
    actions.append(
        createToolbarButton("+", "price_chart_zoom_in", copy("chart_zoom_in"), () => {
            if (!extraction.points.length) return;
            zoomRange(state, ZOOM_IN_FACTOR);
            render();
        }),
        createToolbarButton("-", "price_chart_zoom_out", copy("chart_zoom_out"), () => {
            if (!extraction.points.length) return;
            zoomRange(state, ZOOM_OUT_FACTOR);
            render();
        }),
        createToolbarButton(copy("chart_reset"), "chart_reset", copy("chart_reset"), () => {
            updateDomain(true);
            render();
        })
    );
    toolbar.append(title, actions);

    const pickers = document.createElement("div");
    pickers.className = "price-chart-view__axes";
    const saveStatus = document.createElement("span");
    saveStatus.setAttribute("role", "status");
    const changeAxes = () => {
        if (options.isCurrent && !options.isCurrent()) return;
        axes = { timeColumn: xSelect.value, priceColumn: ySelect.value };
        extraction = extract_price_chart_points(columns, currentRows, data_types, axes);
        updateDomain(true);
        render();
        updateURL(table_name, chartAxesToParams(getParams(table_name), axes));
    };
    const createPicker = (axis, key, selected) => {
        const label = document.createElement("label");
        label.appendChild(translateElement(document.createElement("span"), key));
        const select = document.createElement("select");
        select.dataset.testid = `chart-${axis}-axis`;
        choices[axis].forEach(column => {
            const option = document.createElement("option");
            option.value = column;
            option.dataset.langKey = column;
            option.textContent = column;
            select.appendChild(option);
        });
        select.value = selected;
        select.addEventListener("change", changeAxes);
        label.appendChild(select);
        pickers.appendChild(label);
        return select;
    };
    const xSelect = createPicker('x', 'chart_x_axis', axes.timeColumn);
    const ySelect = createPicker('y', 'chart_y_axis', axes.priceColumn);
    if (options.canSaveDefault && options.onSaveDefault) {
        const save = translateElement(document.createElement("button"), "chart_save_default");
        save.type = "button";
        save.dataset.testid = "chart-save-default";
        save.className = "price-chart-view__toolbar-button";
        save.addEventListener("click", async () => {
            if (options.isCurrent && !options.isCurrent()) return;
            save.disabled = true;
            try {
                await options.onSaveDefault({ ...axes });
                translateElement(saveStatus, "chart_default_saved");
            } catch {
                translateElement(saveStatus, "chart_default_failed");
            } finally {
                save.disabled = false;
            }
        });
        pickers.appendChild(save);
    }
    pickers.appendChild(saveStatus);
    if (options.defaultLoadFailed) translateElement(saveStatus, 'chart_defaults_unavailable');
    root.append(pickers, toolbar, status, plotHost);
    root.commitDatasetRows = (rows, { append, isCurrent }) => {
        if (!isCurrent()) return false;
        currentRows = append ? [...currentRows, ...rows] : rows;
        extraction = extract_price_chart_points(columns, currentRows, data_types, axes);
        updateDomain(!append);
        render();
        return true;
    };
    attachWheelZoom(plotHost, state, render);
    updateDomain(true);
    render();
    return root;
}
