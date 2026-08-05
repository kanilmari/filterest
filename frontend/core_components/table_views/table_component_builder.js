// table_component_builder.js
// Defines TableComponent, a DOM-backed class for multi-view table rendering and state management.
// Bridges tabular row and header data and the DOM with normal, transposed, and ticket layout modes.
// Exists to encapsulate sort, filter, selection, and view-switching state in a single reusable object.
/**
 * table_component_builder.js
 *
 * Tässä moduulissa määritellään TableComponent-luokka, joka
 * mahdollistaa dynaamisen taulun luomisen ja erilaiset näkymätilat
 * (esim. normaali / käänteinen / tiketti).
 *
 * Käyttö:
 *  - Luo TableComponent-olio halutulla datalla ja otsikoilla
 *  - Upota olio DOM:iin esim. container.appendChild(table.getElement())
 *  - Aseta filttereitä (setFilter), vaihda näkymiä (setView), jne.
 */

import {
    generateNormalTable,
    generateTransposedTable,
    generateTicketView
} from './table_layout_builder.js';
import { count_this_function } from '../dev_tools/function_counter.js';
import { makeColumnClass } from '../filterbar/filter_list/column_visibility_handler.js';
import { showSuccessToast, showErrorToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import { getTranslationForKey } from '../lang/translation_handler.js';
import { editCell } from '../general_tables/gt_1_row_crud/gt_1_3_row_update/cell_editor.js';
import {
    GRID_COPY_ACTION_IDS,
    buildGridCopyPayload,
    deriveGridContextMenuPayload,
} from './grid_interactions/context_menu_payload_builder.js';
import { getCellCoordinateFromElement } from './grid_interactions/cell_coordinate_reader.js';
import { EDIT_SESSION_CLICK_ACTIONS, createEditSessionState } from './grid_interactions/edit_session_checker.js';
import { decideEditSessionClickFromTarget } from './grid_interactions/edit_session_dom_checker.js';
import { getAdjacentGridCoordinate, isGridNavigationKey } from './grid_interactions/grid_keyboard_navigation.js';
import {
    enumerateSelectedCells,
    normalizeGridCoordinate,
    normalizeRangeBounds,
    normalizeRangeSelection,
} from './grid_interactions/range_selection_builder.js';
import { setLocalizedDatasetText } from './dataset_value_localizer.js';

export class TableComponent {
    /**
     * Luo uuden TableComponent-olion.
     *
     * @param {Object} params - Olion konfiguraatio.
     * @param {Array<Object>} params.data - Taulukon data taulukkona objekteja.
     * @param {Array<Object>} params.headers - Sarakkeiden määrittely taulukkona.
     * @param {string} [params.initialView='normal'] - Alustava näkymä (normal, transposed tai ticket).
     */
    constructor({
        data,
        headers,
        table_name,                  // ★ uusi parametri
        initialView = 'normal',
        dataTypes = {},
    }) {
        this.data        = data    || [];
        this.headers     = headers || [];
        this.dataTypes   = dataTypes || {};
        this.table_name  = table_name || '';   // ★ tallennetaan
        this.currentView = initialView;
    
        /* --- lajittelu- & filtteri-tilat ----------------------------- */
        this.sortDirections = {};
        this.headers.forEach(h => { this.sortDirections[h.key] = 'asc'; });
    
        this.filterCriteria = {};
        this.headers.forEach(h => { this.filterCriteria[h.key] = ''; });
    
        /* --- valinta- ja DOM-rakenteet (alkuperäinen koodi) ---------- */
        this.isSelecting = false;
        this.startRow    = null;
        this.startCol    = null;
        this.selectionStartCoordinate = null;
        this.selectionMenuPayload = null;
        this.lastClickedListCell = null;
        this.lastClickedListCellAt = 0;
        this.selectionFocusCell = null;
    
        this.rootElement = document.createElement('div');
        this.rootElement.classList.add('table-component-root');
        this.rootElement.tableComponentInstance = this;
    
        /* --- valikon rakentaminen (kopio-napit jne.) ---------------- */
        this.selectionMenu           = document.createElement('div');
        this.selectionMenu.className = 'selection-menu';
        this.selectionMenu.style.position = 'absolute';
        this.selectionMenu.style.display  = 'none';
    
        const copyHeadersBtn = document.createElement('button');
        copyHeadersBtn.dataset.action = 'copy-headers';
        copyHeadersBtn.textContent    = getTranslationForKey('copy_headers_and_cells') || 'Kopioi otsikot + solut';
    
        const copyNoHeadersBtn = document.createElement('button');
        copyNoHeadersBtn.dataset.action = 'copy-no-headers';
        copyNoHeadersBtn.textContent    = getTranslationForKey('copy_cells_only') || 'Kopioi vain solut';
    
        this.selectionMenu.appendChild(copyHeadersBtn);
        this.selectionMenu.appendChild(copyNoHeadersBtn);
        this.rootElement.appendChild(this.selectionMenu);
    
        /* --- valikkonappien kuuntelijat ------------------------------ */
        this.selectionMenu.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (action === 'copy-headers')     this.copySelected(true);
            else if (action === 'copy-no-headers') this.copySelected(false);
            this.hideSelectionMenu();
        });
    
        /* --- ensimmäinen renderointi + event-kuuntelut --------------- */
        this.render();
    
        this.rootElement.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.rootElement.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.rootElement.addEventListener('mouseup',   (e) => this.onMouseUp(e));
        this.rootElement.addEventListener('click', (e) => this.onCellClick(e));
        this.rootElement.addEventListener('contextmenu',(e) => this.onContextMenu(e));
        this.rootElement.addEventListener('dblclick', (e) => this.onCellDoubleClick(e));
        this.rootElement.addEventListener('keydown', (e) => this.onCellKeyDown(e));
    }

    /**
     * Palauttaa pääelementin, jonka voi liittää DOM:iin.
     * @returns {HTMLElement} TableComponentin rootElement.
     */
    getElement() {
        return this.rootElement;
    }

    /**
     * Asettaa uuden datan ja piirtää komponentin uudelleen.
     * @param {Array<Object>} newData - Uusi data taulukkona objekteja
     */
    setData(newData) {
        this.data = newData;
        this.render();
    }

    /**
     * Liittää uutta dataa olemassa olevaan dataan ja päivittää näkymän.
     * @param {Array<Object>} newData - Uusi data liitettäväksi
     */
    appendData(newData) {
        if (!Array.isArray(newData)) {
            console.warn('appendData: newData ei ole taulukko');
            return;
        }
        this.data = this.data.concat(newData);
        this.updateViewWithNewData(newData);
    }

    /**
     * Päivittää näkymän uudella datalla riippuen siitä, mikä näkymä on valittuna.
     * @param {Array<Object>} newData - Uusi data liitettäväksi
     * @private
     */
    updateViewWithNewData(newData) {
        if (this.currentView === 'normal') {
            this.appendToNormalView(newData);
        } else if (this.currentView === 'transposed') {
            this.appendToTransposedView(newData);
        } else if (this.currentView === 'ticket') {
            this.appendToTicketView(newData);
        }
    }

    /**
     * Liittää uutta dataa normal-näkymään.
     * @param {Array<Object>} newData - Uusi data liitettäväksi
     * @private
     */

    appendToNormalView(newData) {
        count_this_function?.('TableComponent_appendToNormalView');
    
        const tableDiv = this.rootElement.querySelector('.table');
        if (!tableDiv) {
            console.warn('Div-based table (".table") not found');
            return;
        }
    
        const existingRows   = tableDiv.querySelectorAll('.row:not(.header)');
        const currentRowCnt  = existingRows.length;
    
        newData.forEach((rowData, idx) => {
            const row = document.createElement('div');
            row.classList.add('row');
    
            this.headers.forEach((header, colIndex) => {
                const colClass   = makeColumnClass(this.table_name, header.key);   // ★
                const cell       = document.createElement('div');
                cell.classList.add('cell', colClass);                             // ★
                cell.tabIndex = 0;
                cell.dataset.row = (currentRowCnt + idx + 1).toString();
                cell.dataset.col = colIndex.toString();
                cell.dataset.rowIndex = (currentRowCnt + idx).toString();
                cell.dataset.colIndex = colIndex.toString();
                cell.dataset.column = header.key;
                cell.dataset.testid = `list-cell-${header.key}`;
    
                const cellContent = document.createElement('div');
                cellContent.className = 'cell-content';
                cellContent.classList.add(colClass);                               // ★
                setLocalizedDatasetText(
                    cellContent,
                    rowData[header.key],
                    this.dataTypes[header.key]
                );
                cellContent.style.whiteSpace = 'pre-wrap';
    
                cell.appendChild(cellContent);
                row.appendChild(cell);
            });
    
            tableDiv.appendChild(row);
        });
    }
    
    /**
     * Liittää uutta dataa transposed-näkymään.
     * @param {Array<Object>} newData - Uusi data liitettäväksi
     * @private
     */
    appendToTransposedView() {
        // Transposed-näkymässä uudet rivit lisätään sarakkeina, joten piirretään koko taulu uudelleen yksinkertaisuuden vuoksi
        this.render();
    }

    /**
     * Liittää uutta dataa ticket-näkymään.
     * @param {Array<Object>} newData - Uusi data liitettäväksi
     * @private
     */
    appendToTicketView(newData) {
        const ticketContainer = this.rootElement.querySelector('.ticket-container');
        if (!ticketContainer) {
            console.warn('Ticket container not found');
            return;
        }
        newData.forEach(rowData => {
            const ticket = document.createElement('div');
            ticket.classList.add('ticket');
            this.headers.forEach(header => {
                const p = document.createElement('p');
                setLocalizedDatasetText(
                    p,
                    rowData[header.key],
                    this.dataTypes[header.key],
                    { prefix: `${header.label}: ` }
                );
                ticket.appendChild(p);
            });
            ticketContainer.appendChild(ticket);
        });
    }

    /**
     * Asettaa filtterin tietylle sarakkeelle ja piirtää komponentin uudelleen.
     * @param {string} key - Sarakkeen avain (header.key)
     * @param {string} value - Filtteröintimerkintä
     */
    setFilter(key, value) {
        this.filterCriteria[key] = value.trim();
        this.render();
    }

    /**
     * Asettaa näkymätilan (normal, transposed tai ticket) ja piirtää uudelleen.
     * @param {string} viewMode - 'normal', 'transposed' tai 'ticket'
     */
    setView(viewMode) {
        this.currentView = viewMode;
        this.render();
    }

    /**
     * Piirtää komponentin uudelleen nykyisten data-, filtteri- ja näkymäasetusten perusteella.
     */
    render() {
        count_this_function?.('TableComponent_render');
    
        const menuRef = this.selectionMenu;
        this.rootElement.replaceChildren();
    
        const filteredData = this.getFilteredData();
    
        let tableElement;
        if (this.currentView === 'normal') {
            tableElement = generateNormalTable(
                filteredData,
                this.headers,
                this.table_name,                           // ★ välitetään ensin
                (key)           => this.sortData(key),
                (fromCol, toCol) => this.reorderColumns(fromCol, toCol),
                this.dataTypes
            );
        } else if (this.currentView === 'transposed') {
            tableElement = generateTransposedTable(
                filteredData,
                this.headers,
                this.table_name,                           // ★
                (key)           => this.sortData(key),
                (fromRow, toRow) => this.reorderColumnsTransposed(fromRow, toRow),
                this.dataTypes
            );
        } else { /* 'ticket' */
            tableElement = generateTicketView(
                filteredData,
                this.headers,
                this.table_name,                           // ★
                (key) => this.sortData(key),
                this.dataTypes
            );
        }
    
        this.rootElement.appendChild(tableElement);
        this.rootElement.appendChild(menuRef);
    
        this.clearSelection();
        this.hideSelectionMenu();
    }
    /**
     * Palauttaa tällä hetkellä asetetun filtterin perusteella suodatetun datan.
     * @private
     * @returns {Array<Object>} Filtteröity data
     */
    getFilteredData() {
        return this.data.filter(item => {
            for (const key in this.filterCriteria) {
                const filterVal = this.filterCriteria[key];
                if (!filterVal) continue;
                const itemVal = String(item[key] || '').toLowerCase();
                if (!itemVal.includes(filterVal.toLowerCase())) {
                    return false;
                }
            }
            return true;
        });
    }

    /**
     * Lajittelee dataa annetun avaimen (key) perusteella (asc/desc vaihtuu).
     * @param {string} key - Sarakkeen avain, jonka mukaan lajitellaan
     */
    sortData(key) {
        this.sortDirections[key] = (this.sortDirections[key] === 'asc') ? 'desc' : 'asc';
        const direction = this.sortDirections[key];

        this.data.sort((a, b) => {
            const valA = a[key];
            const valB = b[key];
            if (typeof valA === 'number' && typeof valB === 'number') {
                return (direction === 'asc') ? valA - valB : valB - valA;
            } else {
                // Merkkijonovertailu
                return (direction === 'asc')
                    ? String(valA).localeCompare(String(valB))
                    : String(valB).localeCompare(String(valA));
            }
        });
        this.render();
    }

    /**
     * SARAKKEIDEN uudelleensijoittaminen normal-näkymässä.
     * @param {number} fromIndex - Sarakkeen alkuperäinen indeksi (headers-taulukossa)
     * @param {number} toIndex   - Sarakkeen uusi indeksi (headers-taulukossa)
     */
    reorderColumns(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;
        const movedHeader = this.headers[fromIndex];
        this.headers.splice(fromIndex, 1);
        this.headers.splice(toIndex, 0, movedHeader);

        // Tallennetaan uusi järjestys localStorageen
        localStorage.setItem('columnsOrder', JSON.stringify(this.headers));

        this.render();
    }

    /**
     * RIVIEN uudelleensijoittaminen transposed-näkymässä.
     * (transposed-näkymä = header = rivi)
     * @param {number} fromIndex - Sarakkeen (rivin) alkuperäinen indeksi
     * @param {number} toIndex   - Sarakkeen (rivin) uusi indeksi
     */
    reorderColumnsTransposed(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;
        const movedHeader = this.headers[fromIndex];
        this.headers.splice(fromIndex, 1);
        this.headers.splice(toIndex, 0, movedHeader);

        localStorage.setItem('columnsOrder', JSON.stringify(this.headers));
        this.render();
    }

    /**
     * Mousedown-event solujen valintaa varten.
     * @param {MouseEvent} e
     * @private
     */
    onMouseDown(e) {
        if (this.currentView === 'ticket') return; // Ei valintaa tiketti-näkymässä
        if (e.button !== 0) return; // Vain vasen hiiren nappi

        // Varmistetaan, että klikkaus kohdistuu soluun
        const cell = e.target.closest?.('.cell');
        if (!cell) {
            // Jos klikataan muualle kuin soluun, nollataan valinta
            if (!this.selectionMenu.contains(e.target)) {
                this.clearSelection();
                this.hideSelectionMenu();
                this.selectionFocusCell = null;
            }
            return;
        }

        // Estetään valinta, jos klikataan raahauskahvaa
        if (e.target.classList.contains('drag-handle')) {
            return;
        }

        if (this.shouldKeepCellEditing(cell, e.target)) {
            e.stopPropagation();
            return;
        }

        const startCoordinate = this.getListSelectionCoordinate(cell);
        if (!startCoordinate) {
            return;
        }

        this.isSelecting = true;
        this.clearSelection();
        this.hideSelectionMenu();

        this.startRow = startCoordinate.rowIndex;
        this.startCol = startCoordinate.columnIndex;
        this.selectionStartCoordinate = startCoordinate;
        this.selectionFocusCell = cell;

        // Korostetaan alkusolu
        this.highlightRegion(this.startRow, this.startCol, this.startRow, this.startCol);
    }

    /** @param {MouseEvent} event */
    onCellClick(event) {
        if (this.currentView !== 'normal' || event.button !== 0) {
            return;
        }

        const cell = event.target.closest?.('.cell');
        if (!this.canEditListCell(cell) || event.target.classList.contains('drag-handle')) {
            return;
        }

        if (this.shouldKeepCellEditing(cell, event.target)) {
            event.stopPropagation();
            return;
        }

        const now = performance.now();
        const shouldEditSelectedCell = (
            cell.classList.contains('selected')
            && this.lastClickedListCell === cell
            && now - this.lastClickedListCellAt < 900
        );

        this.lastClickedListCell = cell;
        this.lastClickedListCellAt = now;

        if (shouldEditSelectedCell) {
            event.preventDefault();
            event.stopPropagation();
            this.startListCellEditing(cell);
        }
    }

    /** @param {MouseEvent} event */
    onCellDoubleClick(event) {
        if (this.currentView !== 'normal') {
            return;
        }

        const cell = event.target.closest?.('.cell');
        if (!this.canEditListCell(cell)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.startListCellEditing(cell);
    }

    /** @param {KeyboardEvent} event */
    onCellKeyDown(event) {
        if (this.currentView === 'transposed') {
            this.onTransposedCellKeyDown(event);
            return;
        }

        if (
            this.currentView !== 'normal'
            || this.isListEditorControlKeyEvent(event)
        ) {
            return;
        }

        const cell = event.target.closest?.('.cell');
        if (!this.canEditListCell(cell)) {
            return;
        }

        if (event.key === 'F2' || event.key === 'Enter') {
            event.preventDefault();
            this.startListCellEditing(cell);
            return;
        }

        if (!isGridNavigationKey(event.key)) {
            return;
        }

        const nextCoordinate = getAdjacentGridCoordinate({
            coordinate: this.getListCellEditCoordinate(cell),
            key: event.key,
            maxRowIndex: this.getFilteredData().length - 1,
            maxColumnIndex: this.headers.length - 1,
        });
        const nextCell = this.getListCellByCoordinate(nextCoordinate);
        if (nextCell) {
            event.preventDefault();
            this.clearSelection();
            nextCell.classList.add('selected');
            this.focusGridCell(nextCell);
            this.lastClickedListCell = nextCell;
            this.lastClickedListCellAt = performance.now();
        }
    }

    /** @param {KeyboardEvent} event */
    onTransposedCellKeyDown(event) {
        if (this.isListEditorControlKeyEvent(event) || !isGridNavigationKey(event.key)) {
            return;
        }

        const cell = event.target.closest?.('.cell') || this.getOnlySelectedCell();
        if (!(cell instanceof HTMLElement)) {
            return;
        }

        const nextCoordinate = getAdjacentGridCoordinate({
            coordinate: this.getListSelectionCoordinate(cell),
            key: event.key,
            maxRowIndex: this.headers.length - 1,
            maxColumnIndex: this.getFilteredData().length,
        });
        const nextCell = this.getTransposedCellByCoordinate(nextCoordinate);
        if (nextCell) {
            event.preventDefault();
            this.clearSelection();
            nextCell.classList.add('selected');
            this.focusGridCell(nextCell);
        }
    }

    /**
     * Focuses a selected grid cell without letting browser scroll steal the interaction.
     * Operates between mouse range-selection and keyboard navigation.
     * Exists so transposed/list arrow-key navigation has a stable focused cell after drag selection.
     *
     * @param {HTMLElement|null} cell
     * @private
     */
    focusGridCell(cell) {
        if (!(cell instanceof HTMLElement) || typeof cell.focus !== 'function') {
            return;
        }

        cell.focus({ preventScroll: true });
    }

    /**
     * Returns the sole selected div-grid cell when selection is a single keyboard anchor.
     * Operates as a fallback for key events whose target is not itself the selected cell.
     *
     * @returns {HTMLElement|null}
     * @private
     */
    getOnlySelectedCell() {
        const selectedCells = this.rootElement.querySelectorAll('.cell.selected');
        return selectedCells.length === 1 && selectedCells[0] instanceof HTMLElement
            ? selectedCells[0]
            : null;
    }

    /** @param {KeyboardEvent} event */
    isListEditorControlKeyEvent(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return false;
        }

        return Boolean(
            target.matches(
                '.table-editor-input, .table-editor-select, .dropdown-search-input'
            )
            || target.closest?.('.custom-dropdown-container')
            || target.closest?.('.cell.editing')
        );
    }

    /** @param {Element|null} cell */
    canEditListCell(cell) {
        const coordinate = this.getListCellEditCoordinate(cell);
        return Boolean(
            cell instanceof HTMLElement
            && !cell.classList.contains('header')
            && !cell.classList.contains('editing')
            && coordinate
            && coordinate.rowIndex < this.getFilteredData().length
            && coordinate.columnIndex < this.headers.length
        );
    }

    /** @param {HTMLElement} cell */
    startListCellEditing(cell) {
        const coordinate = this.syncListCellEditMetadata(cell);
        if (!coordinate) {
            return;
        }

        const visibleData = this.getFilteredData();
        if (!visibleData[coordinate.rowIndex]) {
            return;
        }

        this.clearSelection();
        this.hideSelectionMenu();
        editCell(
            cell,
            this.getColumnKeys(),
            visibleData,
            this.dataTypes,
            this.table_name
        );
    }

    /**
     * Reads the shared list-cell coordinate used for inline editing.
     * Operates between div-list DOM cells and the shared edit-session coordinate adapter.
     * Exists so edit activation does not depend on duplicate data-row-index metadata being pre-rendered.
     *
     * @param {Element|null} cell
     * @returns {{viewType: string, rowIndex: number, columnIndex: number, columnName: string|null}|null}
     * @private
     */
    getListCellEditCoordinate(cell) {
        const coordinate = getCellCoordinateFromElement(cell);
        if (coordinate?.viewType !== 'list') {
            return null;
        }

        return coordinate;
    }

    /**
     * Normalizes editCell metadata onto a div-list cell before opening the shared editor.
     * Operates between list selection data-row/data-col and table-editor data-row-index/data-col-index.
     * Exists because range selection and inline editing historically consumed different metadata names.
     *
     * @param {HTMLElement} cell
     * @returns {{viewType: string, rowIndex: number, columnIndex: number, columnName: string|null}|null}
     * @private
     */
    syncListCellEditMetadata(cell) {
        const coordinate = this.getListCellEditCoordinate(cell);
        if (!coordinate) {
            return null;
        }

        const columnName = coordinate.columnName || this.headers[coordinate.columnIndex]?.key || '';
        cell.dataset.rowIndex = String(coordinate.rowIndex);
        cell.dataset.colIndex = String(coordinate.columnIndex);
        if (columnName) {
            cell.dataset.column = columnName;
        }

        return coordinate;
    }

    /** Keeps clicks inside the active list editor out of drag-selection startup. */
    shouldKeepCellEditing(cell, eventTarget) {
        if (!(cell instanceof HTMLElement) || !cell.classList.contains('editing')) {
            return false;
        }

        const activeCoordinate = this.getListCellEditCoordinate(cell);
        if (!activeCoordinate) {
            return Boolean(
                eventTarget
                && typeof eventTarget.nodeType === 'number'
                && cell.contains(eventTarget)
            );
        }

        const decision = decideEditSessionClickFromTarget({
            session: createEditSessionState({ activeCoordinate }),
            eventTarget,
            activeEditorElement: cell,
            switchOnDifferentCell: false,
            cancelOnOutsideClick: false,
        });

        return decision.action === EDIT_SESSION_CLICK_ACTIONS.KEEP_EDITING;
    }

    /**
     * Mousemove-event solujen valintaa varten.
     * @param {MouseEvent} e
     * @private
     */
    onMouseMove(e) {
        if (!this.isSelecting) return;
        const cell = e.target.closest?.('.cell');
        if (!cell) return;

        const currentCoordinate = this.getListSelectionCoordinate(cell);
        if (!currentCoordinate || !this.selectionStartCoordinate) {
            return;
        }

        this.clearSelection();
        this.highlightRange(normalizeRangeSelection(this.selectionStartCoordinate, currentCoordinate));
        this.selectionFocusCell = cell;
    }

    /**
     * Mouseup-event solujen valintaa varten.
     * @param {MouseEvent}
     * @private
     */
    onMouseUp() {
        if (!this.isSelecting) return;
        this.focusGridCell(this.selectionFocusCell);
        this.isSelecting = false;
        this.selectionStartCoordinate = null;
        this.selectionFocusCell = null;
    }

    /**
     * Oikeaklikkaus (contextmenu) -> näytetään kopiointivalikko valituille soluille.
     * @param {MouseEvent} e
     * @private
     */
    onContextMenu(e) {
        // Alt+rightclick → let it bubble to dev lang key editor
        if (e.altKey) return;
        const cell = e.target.closest?.('.cell');
        if (!cell || !cell.classList.contains('selected')) {
            return;
        }

        const menuPayload = this.buildSelectionContextMenuPayload(cell, e);
        if (!menuPayload.shouldOpen) {
            return;
        }

        e.preventDefault();
        const menuPosition = menuPayload.menuPosition || { x: e.pageX, y: e.pageY };
        this.showSelectionMenu(menuPosition.x, menuPosition.y, menuPayload);
    }

    /**
     * Korostaa (lisää .selected-luokan) solut, jotka ovat annettujen rivi- ja sarakeindeksien välillä.
     * @param {number} r1 - Alkuperäinen rivinumero
     * @param {number} c1 - Alkuperäinen sarakenumero
     * @param {number} r2 - Nykyinen rivinumero
     * @param {number} c2 - Nykyinen sarakenumero
     * @private
     */
    highlightRegion(r1, c1, r2, c2) {
        this.highlightRange(normalizeRangeSelection(
            { rowIndex: r1, columnIndex: c1 },
            { rowIndex: r2, columnIndex: c2 }
        ));
    }

    /**
     * Highlights all cells in a normalized grid range.
     * Operates between shared range-selection math and div-table DOM cells.
     * Exists so future table/list selection can share the same range model.
     *
     * @param {Object|null} rawRange - Range accepted by normalizeRangeBounds.
     * @private
     */
    highlightRange(rawRange) {
        const range = normalizeRangeBounds(rawRange);
        if (!range) {
            return;
        }

        enumerateSelectedCells(range).forEach(({ rowIndex, columnIndex }) => {
            const cell = this.currentView === 'transposed'
                ? this.getTransposedCellByCoordinate({ rowIndex, columnIndex })
                : this.getListCellByCoordinate({ rowIndex, columnIndex });
            if (cell) {
                cell.classList.add('selected');
            }
        });
    }

    /**
     * Poistaa valinnan (poistaa .selected-luokan kaikilta soluilta).
     * @private
     */
    clearSelection() {
        this.rootElement.querySelectorAll('.cell.selected').forEach(cell => {
            cell.classList.remove('selected');
        });
    }

    /**
     * Asettaa valikkonäyn annettuihin koordinaatteihin.
     * @param {number} x
     * @param {number} y
     * @private
     */
    showSelectionMenu(x, y, menuPayload = null) {
        this.selectionMenuPayload = menuPayload;
        this.selectionMenu.style.left = x + 'px';
        this.selectionMenu.style.top = y + 'px';
        this.selectionMenu.style.display = 'block';
    }

    /**
     * Piilottaa valikkonäyn.
     * @private
     */
    hideSelectionMenu() {
        this.selectionMenuPayload = null;
        this.selectionMenu.style.display = 'none';
    }

    /**
     * Kopioi valitut solut (normal- tai transposed-näkymässä) leikepöydälle.
     * @param {boolean} withHeaders - Jos true, kopioi myös otsikkorivin/otsikkosolut
     */
    copySelected(withHeaders) {
        const copyPayload = this.getSelectionMenuCopyPayload(withHeaders)
            ?? this.buildCurrentCopyPayload(withHeaders);
        if (!copyPayload || copyPayload.isEmpty) {
            return;
        }

        const copyText = copyPayload.text.trim();
        navigator.clipboard.writeText(copyText)
            .then(() => {
                showSuccessToast(getTranslationForKey('copied_to_clipboard') || 'Kopioitu leikepöydälle!');
            })
            .catch(err => {
                console.warn('Kopiointi epäonnistui:', err);
                showErrorToast(getTranslationForKey('copy_failed') || 'Kopiointi epäonnistui.');
            });

        this.hideSelectionMenu();
    }

    /**
     * Reads a prepared copy payload from the open shared context-menu payload.
     * Operates between menu button clicks and view-specific copy action descriptors.
     * Exists so list/comparison menus execute the same payload shape as table menus.
     *
     * @param {boolean} withHeaders - Whether to read the copy-with-headers action.
     * @returns {Object|null}
     * @private
     */
    getSelectionMenuCopyPayload(withHeaders) {
        const actionId = withHeaders
            ? GRID_COPY_ACTION_IDS.COPY_WITH_HEADERS
            : GRID_COPY_ACTION_IDS.COPY_WITHOUT_HEADERS;
        const action = this.selectionMenuPayload?.copyActions?.find(
            (copyAction) => copyAction.id === actionId
        );
        return action?.payload ?? null;
    }

    /**
     * Builds the shared context-menu payload for the current selected cells.
     * Operates between a right-clicked cell and the grid context menu layer.
     * Exists so normal/list table selection no longer owns custom menu math.
     *
     * @param {HTMLElement} cell - Right-clicked selected cell.
     * @param {MouseEvent} event - Browser context menu event.
     * @returns {Object}
     * @private
     */
    buildSelectionContextMenuPayload(cell, event) {
        if (this.currentView === 'transposed') {
            return this.buildTransposedSelectionContextMenuPayload(cell, event);
        }

        return deriveGridContextMenuPayload({
            range: this.getSelectedRange(),
            triggerCoordinate: this.getListSelectionCoordinate(cell),
            menuPosition: event,
            columns: this.getColumnDescriptors(),
            copyOptions: this.getNormalCopyOptions(),
        });
    }

    /**
     * Builds a copy payload for the currently active selectable view.
     * Operates between the selection menu and view-specific grid axes.
     * Exists so list and comparison views share copy payload construction.
     *
     * @param {boolean} withHeaders - Whether copied text should include header context.
     * @returns {Object|null}
     * @private
     */
    buildCurrentCopyPayload(withHeaders) {
        return this.currentView === 'transposed'
            ? this.buildTransposedCopyPayload(withHeaders)
            : this.buildNormalCopyPayload(withHeaders);
    }

    /**
     * Builds a copy payload for the normal div-list view through the shared layer.
     * Operates between selected DOM cells and clipboard-ready text rows.
     * Exists to keep copy behavior compatible while moving range logic into one module.
     *
     * @param {boolean} withHeaders - Whether the first copied row should be column labels.
     * @returns {Object}
     * @private
     */
    buildNormalCopyPayload(withHeaders) {
        return buildGridCopyPayload({
            range: this.getSelectedRange(),
            columns: this.getColumnDescriptors(),
            includeHeaders: withHeaders,
            ...this.getNormalCopyOptions(),
        });
    }

    /**
     * Returns shared copy options for the normal div-list view.
     * Operates between DOM-backed visible cells and pure copy payload building.
     * Exists so the shared copy builder can preserve current visible-cell text output.
     *
     * @returns {Object}
     * @private
     */
    getNormalCopyOptions() {
        return {
            delimiter: ',',
            valueResolver: ({ rowIndex, columnIndex }) => this.getCellText(rowIndex, columnIndex),
        };
    }

    /**
     * Converts headers into shared column descriptors.
     * Operates between TableComponent header objects and grid copy metadata.
     * Exists so context-menu copy labels follow the rendered header labels.
     *
     * @returns {Array<Object>}
     * @private
     */
    getColumnDescriptors() {
        return this.headers.map((header) => ({
            key: header.key,
            label: header.label || header.key,
        }));
    }

    /**
     * Builds a context-menu payload for comparison/transposed selected cells.
     * Operates between the historical transposed DOM coordinates and shared menu math.
     * Exists so comparison view exposes the same copy actions as table and list adapters.
     *
     * @param {HTMLElement} cell - Right-clicked selected cell.
     * @param {MouseEvent} event - Browser context menu event.
     * @returns {Object}
     * @private
     */
    buildTransposedSelectionContextMenuPayload(cell, event) {
        const menuPayload = deriveGridContextMenuPayload({
            range: this.getSelectedRange(),
            triggerCoordinate: this.getListSelectionCoordinate(cell),
            menuPosition: event,
            columns: this.getTransposedColumnDescriptors(),
            copyOptions: this.getTransposedCopyOptions(),
        });

        if (!menuPayload.shouldOpen) {
            return menuPayload;
        }

        return {
            ...menuPayload,
            copyActions: menuPayload.copyActions.map((copyAction) => {
                const payload = this.buildTransposedCopyPayload(copyAction.includeHeaders);
                return {
                    ...copyAction,
                    enabled: !payload.isEmpty,
                    payload,
                };
            }),
        };
    }

    /**
     * Converts visible comparison columns into shared copy descriptors.
     * Operates between transposed data-record columns and generic grid metadata.
     * Exists so comparison copy actions can use the same payload builder as table/list.
     *
     * @returns {Array<Object>}
     * @private
     */
    getTransposedColumnDescriptors() {
        return [
            {
                key: '__field_label__',
                label: getTranslationForKey('field') || 'Field',
            },
            ...this.getFilteredData().map((row, index) => ({
                key: String(row?.id ?? row?.uuid ?? row?.name ?? row?.title ?? index + 1),
                label: String(row?.name ?? row?.title ?? row?.label ?? row?.id ?? index + 1),
            })),
        ];
    }

    /**
     * Returns shared copy options for the comparison/transposed view.
     * Operates between DOM-backed transposed cells and pure copy payload building.
     * Exists to preserve visible-cell text while reusing the shared copy payload layer.
     *
     * @returns {Object}
     * @private
     */
    getTransposedCopyOptions() {
        return {
            delimiter: ',',
            valueResolver: ({ rowIndex, columnIndex }) => this.getCellText(rowIndex, columnIndex),
        };
    }

    /** @returns {Array<string>} */
    getColumnKeys() {
        return this.headers.map((header) => header.key);
    }

    /**
     * Reads visible text from one rendered div-table cell.
     * Operates between shared copy coordinates and the DOM that users selected.
     * Exists to preserve rendered text semantics while the copy layer is centralized.
     *
     * @param {number} rowIndex - Grid row index.
     * @param {number} columnIndex - Grid column index.
     * @returns {string}
     * @private
     */
    getCellText(rowIndex, columnIndex) {
        const cell = this.currentView === 'transposed'
            ? this.getTransposedCellByCoordinate({ rowIndex, columnIndex })
            : this.getListCellByCoordinate({ rowIndex, columnIndex });
        const content = cell?.querySelector?.('.cell-content');
        return content ? content.textContent : (cell?.textContent ?? '');
    }

    /**
     * Builds a shared copy payload for comparison/transposed selected cells.
     * Operates between historical row/column DOM coordinates and the shared grid copy layer.
     * Exists to give comparison view the same copy semantics as table and list without copying control chrome.
     *
     * @param {boolean} withHeaders - Whether row labels should be copied before values.
     * @returns {Object}
     * @private
     */
    buildTransposedCopyPayload(withHeaders) {
        const payload = buildGridCopyPayload({
            range: this.getSelectedRange(),
            columns: this.getTransposedColumnDescriptors(),
            includeHeaders: false,
            ...this.getTransposedCopyOptions(),
        });

        if (!withHeaders || payload.isEmpty) {
            return {
                ...payload,
                includeHeaders: withHeaders,
            };
        }

        const rowsWithLabels = payload.rows.map((rowValues, rowOffset) => {
            const rowIndex = payload.range.minRowIndex + rowOffset;
            return [this.getCellText(rowIndex, 0), ...rowValues];
        });

        return {
            ...payload,
            includeHeaders: true,
            headers: [],
            rows: rowsWithLabels,
            text: rowsWithLabels.map((rowValues) => rowValues.join(payload.delimiter)).join(payload.lineBreak),
        };
    }

    /**
     * Selvittää valittujen solujen pienimmän ja suurimman (rivi, sarake) -arvon.
     * @private
     * @returns {{ minRow: number, maxRow: number, minCol: number, maxCol: number } | null} 
     *   null, jos ei valittuja soluja.
     */
    getSelectedRange() {
        const selectedCells = this.rootElement.querySelectorAll('.cell.selected');
        if (!selectedCells.length) return null;

        const selectedCoordinates = Array.from(selectedCells)
            .map((cell) => this.getListSelectionCoordinate(cell))
            .filter(Boolean);
        if (!selectedCoordinates.length) return null;

        const rowIndexes = selectedCoordinates.map((coordinate) => coordinate.rowIndex);
        const columnIndexes = selectedCoordinates.map((coordinate) => coordinate.columnIndex);
        const range = normalizeRangeBounds({
            minRowIndex: Math.min(...rowIndexes),
            maxRowIndex: Math.max(...rowIndexes),
            minColumnIndex: Math.min(...columnIndexes),
            maxColumnIndex: Math.max(...columnIndexes),
        });

        if (!range) return null;

        return {
            ...range,
            minRow: range.minRowIndex,
            maxRow: range.maxRowIndex,
            minCol: range.minColumnIndex,
            maxCol: range.maxColumnIndex,
        };
    }

    /** Reads list selection coordinates without using edit-only data-row-index metadata. */
    getListSelectionCoordinate(cell) {
        if (!(cell instanceof HTMLElement)) {
            return null;
        }
        if (this.currentView === 'transposed') {
            return normalizeGridCoordinate({
                row: cell.dataset.row,
                col: cell.dataset.col,
            });
        }

        return this.getListCellEditCoordinate(cell);
    }

    /**
     * Finds one normal div-list cell by zero-based shared grid coordinates.
     * Operates between shared keyboard/range helpers and list DOM attributes.
     * Exists so list selection and keyboard movement use the same coordinate model.
     *
     * @param {{rowIndex: number, columnIndex: number}|null} coordinate
     * @returns {HTMLElement|null}
     * @private
     */
    getListCellByCoordinate(coordinate) {
        const normalizedCoordinate = normalizeGridCoordinate(coordinate);
        if (!normalizedCoordinate) {
            return null;
        }

        const cell = this.rootElement.querySelector(
            `.cell[data-row-index='${normalizedCoordinate.rowIndex}'][data-col-index='${normalizedCoordinate.columnIndex}']`
        );
        return cell instanceof HTMLElement ? cell : null;
    }

    /**
     * Finds one transposed div cell by its historical row/column coordinates.
     * Operates between legacy transposed selection and DOM attributes.
     * Exists to keep transposed copy behavior stable while normal list cells become zero-based.
     *
     * @param {{rowIndex: number, columnIndex: number}|null} coordinate
     * @returns {HTMLElement|null}
     * @private
     */
    getTransposedCellByCoordinate(coordinate) {
        const normalizedCoordinate = normalizeGridCoordinate(coordinate);
        if (!normalizedCoordinate) {
            return null;
        }

        const cell = this.rootElement.querySelector(
            `.cell[data-row='${normalizedCoordinate.rowIndex}'][data-col='${normalizedCoordinate.columnIndex}']`
        );
        return cell instanceof HTMLElement ? cell : null;
    }

    /**
     * Poistaa komponentin DOM:ista.
     * @public
     */
    destroy() {
        if (this.rootElement && this.rootElement.parentNode) {
            this.rootElement.parentNode.removeChild(this.rootElement);
        }
    }
}
