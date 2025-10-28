import WebSkel from './WebSkel/webskel.mjs';
import assistosSDK from './services/assistosSDK.js';
import initialiseAssistOS from './services/assistOSShim.js';

async function start() {
    const webSkel = await WebSkel.initialise('webskel.json');
    webSkel.appServices = assistosSDK;

    const assistOS = initialiseAssistOS({ ui: webSkel });
    assistOS.webSkel = webSkel;
    assistOS.appServices = assistosSDK;
    if (typeof window !== 'undefined') {
        window.UI = webSkel;
    }

    const originalShowModal = typeof webSkel.showModal === 'function' ? webSkel.showModal.bind(webSkel) : null;
    webSkel.showModal = async (name, payload = {}, expectResult = false) => {
        const component = webSkel.configs?.components?.find?.((item) => item.name === name);
        if (component && typeof originalShowModal === 'function') {
            return originalShowModal(name, payload, expectResult);
        }

        switch (name) {
            case 'confirm-action-modal': {
                const message = payload?.message ?? 'Are you sure?';
                const confirmed = typeof window !== 'undefined'
                    ? window.confirm(message)
                    : true;
                return expectResult ? confirmed : undefined;
            }
            case 'add-comment': {
                if (typeof window === 'undefined') {
                    return expectResult ? '' : undefined;
                }
                const result = window.prompt('Enter comment', '');
                return expectResult ? result : undefined;
            }
            default: {
                console.warn(`[assistOS] Modal "${name}" is not registered in the local configs.`);
                return expectResult ? null : undefined;
            }
        }
    };

    webSkel.setLoading(`<div class="spinner-container"><div class="spin"></div></div>`);
    webSkel.setDomElementForPages(document.querySelector("#page_content"));
    const loader = document.querySelector("#before_webskel_loader");
    loader.close(); // Close the loader
    loader.remove();

    const hash = window.location.hash;
    let pageName;
    let url;
    if(hash){
        url = hash.substring(1);
        pageName = url.split('/')[0].split('?')[0];
    } else {
        pageName = 'file-exp';
        url = 'file-exp';
    }

    await webSkel.changeToDynamicPage(pageName || 'file-exp', url || 'file-exp');
    window.webSkel = webSkel;
}

start();
