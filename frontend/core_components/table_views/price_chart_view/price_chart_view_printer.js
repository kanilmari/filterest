// price_chart_view_printer.js
// Renders generic price rows into a zoomable SVG line chart.
// Bridges inferred time-series data and the dataset view rendering system.
// Exists to provide a small dependency-free chart view for price history datasets.

import {
    extract_price_chart_points,
    format_price_chart_time,
    format_price_chart_value,
} from "./price_chart_data_reader.js";

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
        format_price_chart_time(state.visibleStartTime),
        PLOT_PADDING.left,
        plotBottom + 34,
        "price-chart-view__axis-label",
        "start"
    ));
    svg.appendChild(createSvgText(
        format_price_chart_time(state.visibleEndTime),
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
function appendPointMarkers(svg, visiblePoints, scale) {
    visiblePoints.forEach((point) => {
        const marker = createSvgElement("circle", {
            cx: scale.xForTime(point.time).toFixed(2),
            cy: scale.yForPrice(point.price).toFixed(2),
            r: 3.5,
            class: "price-chart-view__point",
        });
        marker.appendChild(createSvgElement("title"));
        marker.querySelector("title").textContent = `${format_price_chart_time(point.time)}: ${format_price_chart_value(point.price)}`;
        svg.appendChild(marker);
    });
}

// Creates the empty or unsupported state for non-price datasets.
function createNoticeElement(titleKey, titleText, bodyKey, bodyText) {
    const notice = document.createElement("div");
    notice.classList.add("price-chart-view__notice");

    const title = document.createElement("h3");
    title.dataset.langKey = titleKey;
    title.textContent = titleText;

    const body = document.createElement("p");
    body.dataset.langKey = bodyKey;
    body.textContent = bodyText;

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
    range.textContent = `${format_price_chart_time(state.visibleStartTime)} - ${format_price_chart_time(state.visibleEndTime)}`;

    const columns = document.createElement("span");
    columns.classList.add("price-chart-view__status-item", "price-chart-view__status-item--muted");
    columns.textContent = `${timeColumn} / ${priceColumn}`;

    statusElement.append(count, range, columns);
}

// Renders the SVG chart for the current state.
function renderChart(plotHost, statusElement, points, state, timeColumn, priceColumn) {
    plotHost.replaceChildren();
    const visiblePoints = getVisiblePoints(points, state);
    updateStatusElement(statusElement, state, visiblePoints.length, points.length, timeColumn, priceColumn);

    if (visiblePoints.length === 0) {
        plotHost.appendChild(createNoticeElement(
            "price_chart_no_visible_data_title",
            "No visible price data",
            "price_chart_no_visible_data_body",
            "Reset the chart range or zoom out to show price rows."
        ));
        return;
    }

    const svg = createSvgElement("svg", {
        class: "price-chart-view__svg",
        viewBox: `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`,
        role: "img",
        "aria-label": "Price chart",
        preserveAspectRatio: "xMidYMid meet",
    });
    const scale = createScale(state, visiblePoints);
    appendGridAndAxes(svg, state, scale);
    if (visiblePoints.length > 1) {
        svg.appendChild(createLinePath(visiblePoints, scale));
    }
    appendPointMarkers(svg, visiblePoints, scale);
    plotHost.appendChild(svg);
}

// Wires Alt+wheel zooming to the plot host.
function attachWheelZoom(plotHost, state, render) {
    plotHost.addEventListener("wheel", (event) => {
        if (!event.altKey) {
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
 * Creates the price chart view for a dataset.
 * Operates between dataset_view_printer.js and inferred price-series rows.
 * Exists as the integration point for the reusable dataset view registry.
 */
export function create_price_chart_view(table_name, columns, data, data_types = {}) {
    const extraction = extract_price_chart_points(columns, data, data_types);
    const root = document.createElement("section");
    root.classList.add("price-chart-view");
    root.dataset.datasetName = table_name;
    root.dataset.testid = "price-chart-view";

    if (!extraction.timeColumn || !extraction.priceColumn) {
        root.appendChild(createNoticeElement(
            "price_chart_missing_columns_title",
            "No price chart columns found",
            "price_chart_missing_columns_body",
            "Add one date or timestamp column and one numeric price column."
        ));
        return root;
    }

    if (extraction.points.length < 1) {
        root.appendChild(createNoticeElement(
            "price_chart_no_data_title",
            "No price data found",
            "price_chart_no_data_body",
            "Rows need valid time and price values before the chart can render."
        ));
        return root;
    }

    const domainStartTime = extraction.points[0].time;
    const domainEndTime = extraction.points[extraction.points.length - 1].time;
    const state = {
        domainStartTime,
        domainEndTime,
        visibleStartTime: domainStartTime,
        visibleEndTime: domainEndTime,
    };

    const toolbar = document.createElement("div");
    toolbar.classList.add("price-chart-view__toolbar");

    const title = document.createElement("h3");
    title.classList.add("price-chart-view__title");
    title.dataset.langKey = "price_chart_view_title";
    title.textContent = "Price chart";

    const actions = document.createElement("div");
    actions.classList.add("price-chart-view__toolbar-actions");
    const render = () => renderChart(
        plotHost,
        status,
        extraction.points,
        state,
        extraction.timeColumn,
        extraction.priceColumn
    );
    actions.append(
        createToolbarButton("+", "price_chart_zoom_in", "Zoom in", () => {
            zoomRange(state, ZOOM_IN_FACTOR);
            render();
        }),
        createToolbarButton("-", "price_chart_zoom_out", "Zoom out", () => {
            zoomRange(state, ZOOM_OUT_FACTOR);
            render();
        }),
        createToolbarButton("Reset", "price_chart_reset_zoom", "Reset zoom", () => {
            state.visibleStartTime = state.domainStartTime;
            state.visibleEndTime = state.domainEndTime;
            render();
        })
    );

    toolbar.append(title, actions);

    const status = document.createElement("div");
    status.classList.add("price-chart-view__status");

    const plotHost = document.createElement("div");
    plotHost.classList.add("price-chart-view__plot-host");
    plotHost.dataset.testid = "price-chart-plot";
    plotHost.title = "Alt+scroll zooms the time range";

    root.append(toolbar, status, plotHost);
    attachWheelZoom(plotHost, state, render);
    render();
    return root;
}
