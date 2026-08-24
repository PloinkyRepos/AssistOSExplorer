export const APP_MENU_ITEMS_SET_EVENT = 'app-menu-items-set';

export function dispatchAppMenuItemsSet(element, items) {
    if (!element) return false;
    element.dispatchEvent(new CustomEvent(APP_MENU_ITEMS_SET_EVENT, {
        detail: { items: Array.isArray(items) ? items : [] }
    }));
    return true;
}
