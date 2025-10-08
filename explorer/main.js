import WebSkel from './WebSkel/webskel.mjs';

async function start() {
    const webSkel = await WebSkel.initialise('webskel.json');
    webSkel.setLoading(`<div class="spinner-container"><div class="spin"></div></div>`);
    webSkel.setDomElementForPages(document.querySelector("#page_content"));
    const loader = document.querySelector("#before_webskel_loader");
    loader.close(); // Close the loader
    loader.remove();
    await webSkel.changeToDynamicPage('main-page', 'main-page');
    window.webSkel = webSkel;
}

start();
