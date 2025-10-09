import WebSkel from './WebSkel/webskel.mjs';
import assistosSDK from './services/assistosSDK.js';

async function start() {
    const webSkel = await WebSkel.initialise('webskel.json');
    webSkel.appServices = assistosSDK;
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
