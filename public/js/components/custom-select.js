// FortunaPanel - Custom Select Component
// Replaces native <select> elements with dark-themed custom dropdowns
// to avoid white popup rendering in Electron on Windows.

/**
 * Replace all <select class="form-select"> elements inside a container
 * with custom-styled dropdown components.
 * @param {HTMLElement} container - The container to search within
 */
export function replaceSelects(container) {
    if (!container) return;
    const selects = container.querySelectorAll('select.form-select');
    selects.forEach(select => {
        // Skip if already replaced
        if (select.closest('.custom-select-wrapper')) return;
        createCustomSelect(select);
    });
}

/**
 * Build a custom dropdown around an existing <select> element.
 * The native select is hidden but kept in DOM so form logic and
 * .value reads continue to work.
 */
function createCustomSelect(select) {
    // Wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper';

    // Copy any extra classes from the select (e.g. max-w-[260px], text-xs)
    const extraClasses = [];
    select.classList.forEach(cls => {
        if (cls !== 'form-select') extraClasses.push(cls);
    });
    if (extraClasses.length) wrapper.classList.add(...extraClasses);

    // Insert wrapper where the select is
    select.parentNode.insertBefore(wrapper, select);

    // Move select inside wrapper and hide it
    wrapper.appendChild(select);
    select.style.position = 'absolute';
    select.style.width = '1px';
    select.style.height = '1px';
    select.style.opacity = '0';
    select.style.overflow = 'hidden';
    select.style.pointerEvents = 'none';
    select.setAttribute('tabindex', '-1');
    select.setAttribute('aria-hidden', 'true');

    // Trigger button
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    if (select.disabled) trigger.disabled = true;

    const selectedOption = select.options[select.selectedIndex];
    const triggerText = document.createElement('span');
    triggerText.className = 'custom-select-trigger-text';
    triggerText.textContent = selectedOption ? selectedOption.textContent : '';

    const chevron = document.createElement('span');
    chevron.className = 'custom-select-chevron';
    chevron.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;

    trigger.appendChild(triggerText);
    trigger.appendChild(chevron);
    wrapper.appendChild(trigger);

    // Options panel
    const panel = document.createElement('div');
    panel.className = 'custom-select-options';
    panel.setAttribute('role', 'listbox');
    buildOptions(panel, select);
    wrapper.appendChild(panel);

    // --- Event handling ---

    // Toggle dropdown
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (select.disabled) return;
        const isOpen = wrapper.classList.contains('open');
        closeAllDropdowns();
        if (!isOpen) {
            wrapper.classList.add('open');
            // Scroll selected into view
            const sel = panel.querySelector('.custom-select-option.selected');
            if (sel) sel.scrollIntoView({ block: 'nearest' });
        }
    });

    // Option click
    panel.addEventListener('click', (e) => {
        const optionEl = e.target.closest('.custom-select-option');
        if (!optionEl) return;
        const value = optionEl.dataset.value;
        if (select.value !== value) {
            select.value = value;
            // Update displayed text
            triggerText.textContent = optionEl.textContent;
            // Update selected state
            panel.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
            optionEl.classList.add('selected');
            // Fire native change event
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        wrapper.classList.remove('open');
    });

    // Keyboard support
    trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            wrapper.classList.remove('open');
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            trigger.click();
        }
    });

    // Close on Escape is handled by a SINGLE global keydown listener at
    // module load time (see bottom of file). The previous code added a
    // per-instance `document.addEventListener('keydown', ...)` that was
    // never removed — across SPA navigations these accumulated.

    // Observe disabled attribute changes on native select
    const disabledObserver = new MutationObserver(() => {
        trigger.disabled = select.disabled;
    });
    disabledObserver.observe(select, { attributes: true, attributeFilter: ['disabled'] });

    // If the native select value is changed programmatically, sync display
    // (using a MutationObserver on children to catch dynamic option rebuilds)
    const childObserver = new MutationObserver(() => {
        buildOptions(panel, select);
        const cur = select.options[select.selectedIndex];
        triggerText.textContent = cur ? cur.textContent : '';
    });
    childObserver.observe(select, { childList: true, subtree: true });

    // Disconnect both observers when the wrapper is removed from the DOM
    // (SPA navigation, modal close, etc.). Without this, observers keep
    // references to wrapper/trigger/select and pile up forever.
    if (wrapper.parentNode) {
        const removalObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const removed of m.removedNodes) {
                    if (removed === wrapper || (removed.contains && removed.contains(wrapper))) {
                        disabledObserver.disconnect();
                        childObserver.disconnect();
                        removalObserver.disconnect();
                        return;
                    }
                }
            }
        });
        removalObserver.observe(wrapper.parentNode, { childList: true, subtree: true });
    }
}

/**
 * Build option elements inside the panel from the native select's options.
 */
function buildOptions(panel, select) {
    panel.innerHTML = '';
    Array.from(select.options).forEach(opt => {
        const div = document.createElement('div');
        div.className = 'custom-select-option';
        div.setAttribute('role', 'option');
        div.dataset.value = opt.value;
        div.textContent = opt.textContent;
        if (opt.selected) div.classList.add('selected');
        panel.appendChild(div);
    });
}

/**
 * Close all open custom-select dropdowns on the page.
 */
function closeAllDropdowns() {
    document.querySelectorAll('.custom-select-wrapper.open').forEach(w => {
        w.classList.remove('open');
    });
}

// Global click-outside listener (registered once)
document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-select-wrapper')) {
        closeAllDropdowns();
    }
});

// Global Escape listener (registered once) — replaces the per-instance
// keydown listener that previously accumulated on every custom-select
// creation across SPA navigations.
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeAllDropdowns();
    }
});

/**
 * Start a MutationObserver that automatically replaces any new
 * <select class="form-select"> elements as they appear in the DOM.
 * Call once at app init.
 * @param {HTMLElement} root - The root element to observe (e.g. document.body)
 */
let observerStarted = false;
export function observeSelects(root) {
    if (observerStarted) return;
    observerStarted = true;

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue; // skip text nodes
                // Check if the added node IS a select or CONTAINS selects
                if (node.matches?.('select.form-select') && !node.closest('.custom-select-wrapper')) {
                    createCustomSelect(node);
                } else if (node.querySelectorAll) {
                    const selects = node.querySelectorAll('select.form-select');
                    selects.forEach(sel => {
                        if (!sel.closest('.custom-select-wrapper')) {
                            createCustomSelect(sel);
                        }
                    });
                }
            }
        }
    });

    observer.observe(root, { childList: true, subtree: true });
}
