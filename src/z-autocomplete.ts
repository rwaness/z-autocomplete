import { LitElement, render } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { map } from 'lit/directives/map.js';
import { html } from 'lit/static-html.js';

export interface ZAutocompleteOption {
    label: string | HTMLElement,
    value: any,
    inputValue?: string,
    disabled?: boolean,
}

const debounce: Function = (cb: Function, delay: number = 1000) => {
    let timer: number;

    return (...args: any[]) => {
        clearTimeout(timer);

        timer = setTimeout(() => {
            cb(...args);
        }, delay);
    };
};

const clamp = (nb: Number, { min = -Infinity, max = Infinity }) => {
    return Math.max(min, Math.min(Number(nb) || min, max));
}

@customElement('z-autocomplete')
export class ZAutocomplete extends LitElement {
    // no shadow root!
    createRenderRoot() {
        return this;
    }

    // --- dom refs
    @query('[data-z-autocomplete-input]')
    private _inputEl!: HTMLInputElement | HTMLTextAreaElement; // | ElementContentEditable;

    @query('[data-z-autocomplete-clear]')
    private _clearEl!: HTMLElement;

    @query('[data-z-autocomplete-options]')
    private _optionsEl!: HTMLUListElement;

    // --- properties & state
    private _abortController?: AbortController;

    @state()
    private _activeOptionIndex?: number;

    // options visibility
    @property({ type: Boolean })
    set open(val: boolean) {
        this._optionsEl.hidden = !val || !this.options.length;
        this._inputEl.setAttribute('aria-expanded', String(!this._optionsEl.hidden));
    }
    get open() {
        return !this._optionsEl.hidden;
    }

    // value
    private _value ?: any;
    @property()
    set value(val: any) {
        this._value = val;
        this._clearOptions();

        const option = this.dataToOption(val);
        this._inputEl.value = option?.inputValue
            ?? (typeof option?.label === 'string' ? option?.label : '')
            ?? '';

        this.dispatchEvent(new CustomEvent('autocomplete', {
            detail: val,
            bubbles: true,
            // composed: true, // no need because no shadowDom is used ?
        }));
    }
    get value() {
        return this._value;
    };

    // options
    private _options: ZAutocompleteOption[] = [];
    @property({ type: Array })
    set options(val: ZAutocompleteOption[]) {
        this._options = val;
        this._renderOptions();
        this.open = !!val.length;
    }
    get options() {
        return this._options;
    }

    // --- init
    constructor() {
        super();

        // override methode for a debounced one.
        this._onInputChange = debounce(this._onInputChange.bind(this), 300);
    }

    connectedCallback(): void {
        super.connectedCallback();

        this._initInputEl();
        this._initOptionsEl();

        this._inputEl.addEventListener('input', this._onInput.bind(this));

        if (this._clearEl) {
            this._initClearEl();
            this._clearEl.addEventListener('click', this._onClear.bind(this));
        }

        document.addEventListener('click', this._handleClickOutside.bind(this));
        this./*_inputEl.*/addEventListener('keydown', this._onKeydown.bind(this));
    }

    disconnectedCallback(): void {
        super.disconnectedCallback();

        this._abortController?.abort('element is beeing destroyed');

        this._inputEl.removeEventListener('input', this._onInput.bind(this));
        if (this._clearEl) this._clearEl.removeEventListener('click', this._onClear.bind(this))
        document.removeEventListener('click', this._handleClickOutside.bind(this));
        this./*_inputEl.*/removeEventListener('keydown', this._onKeydown.bind(this));

    }

    // --- private methods
    private _initInputEl(): void {
        if(!this._inputEl) throw new Error('No <input> element provided to take control on');

        this._inputEl.setAttribute('role', 'combobox');
        this._inputEl.setAttribute('aria-expanded', 'false');
        this._inputEl.setAttribute('aria-autocomplete', 'list');
        this._inputEl.setAttribute('aria-haspopup', 'listbox');
        this._inputEl.setAttribute('autocomplete', 'off');
        this._inputEl.setAttribute('spellcheck', 'false');
    }

    private _initClearEl(): void {
        this._clearEl.setAttribute('type', 'button');
        this._clearEl.hidden = true;
    }

    private _initOptionsEl(): void {
        if(!this._optionsEl) throw new Error('No <ul> element provided to take control on');

        this._optionsEl.setAttribute('role', 'listbox');
        this._optionsEl.hidden = true;
    }

    private _onClear() {
        this._abortController?.abort('the input has been cleared.');
        this.value = undefined;
        if (this._clearEl) this._clearEl.hidden = true;
    }

    private _clearOptions() {
        this.options = [];
        this.open = false;
        this._activeOptionIndex = undefined;
    }

    private _handleClickOutside(e: Event) {
        const event = e as MouseEvent;

        this.open = this.contains(event.target as Node | null);
    }

    private _onKeydown(e: Event) {
        const event = e as KeyboardEvent;

        if (!this.options.length || !this.open) return;

        switch (event.key) {
            case 'ArrowDown':
                this._navigateToOption();
                event.preventDefault();
                break;
            case 'ArrowUp':
                this._navigateToOption(-1);
                event.preventDefault();
                break;
            case 'Enter':
                    this._selectOption(this.options[this._activeOptionIndex ?? -1]);
                    event.preventDefault();
                break;
        }
    }

    private _onInput(e: Event) {
        e.stopPropagation();
        this._clearOptions();

        if (!this._inputEl.value) {
            if (this._clearEl) this._clearEl.hidden = true;
            return this._onClear();
        }

        if (this._clearEl) this._clearEl.hidden = false;
        this._abortController?.abort('A new search has been performed');
        this._abortController = new AbortController();

        this._onInputChange();
    }

    private async _onInputChange() {
        const data = await this.fetchData(this._inputEl.value, this._abortController?.signal);
        const optionsData = data.map(this.dataToOption.bind(this));
        this.options = optionsData.filter(Boolean) as ZAutocompleteOption[];
    }

    private _renderOptions() {
        let template;

        if (this.options.length) template = map(this.options, this._formatOptionTemplate.bind(this));

        render(template || '', this._optionsEl);
    }

    private _formatOptionTemplate(option: ZAutocompleteOption, index: number) {
        return html`
            <li @click="${() => this._selectOption(option)}"
                data-index="${index}"
                aria-selected="${index === this._activeOptionIndex}"
                aria-disabled="${!!option.disabled}">
                ${option.label}
            </li>
        `
    }

    private _selectOption(option: ZAutocompleteOption) {
        if (option.disabled) return;

        this.value = option.value;
        this._activeOptionIndex = undefined;
    }

    private _navigateToOption(offset: number = 1) {
        let newIndex: number | undefined = Number(this._activeOptionIndex ?? -1);
        newIndex += offset;
        newIndex = clamp(newIndex, { min: 0, max: this.options.length - 1 });

        if (newIndex === this._activeOptionIndex) newIndex = undefined;

        this._activeOptionIndex = newIndex;

        // if the option chosen is disabled, we pass
        if (typeof newIndex === 'number' && this.options[newIndex].disabled) {
            this._navigateToOption(offset);
            return;
        }

        // No rerender needed:
        const optionEls = [...this._optionsEl.querySelectorAll('li')]

        optionEls.forEach((el) => {
            const isSelected = el.dataset.index === String(newIndex);

            el.setAttribute('aria-selected', String(isSelected));

            if (isSelected) el.scrollIntoView({ block: 'nearest' }); // needed if the ul is scrollable
        })
    }

    // --- to be implemented from the exterior
    public async fetchData(inputValue: string, abortSignal?: AbortSignal): Promise<any[]> {
        console.warn('YOU MUST IMPLEMENT THE fetchOptions METHOD!', { inputValue, aborted: abortSignal?.aborted });
        return [];
    }

    public dataToOption(data: any): ZAutocompleteOption | undefined {
        return {
            label: String(data),
            value: data,
        };
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'z-autocomplete': ZAutocomplete,
    }
}
