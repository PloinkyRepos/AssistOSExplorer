class UIService {
    constructor() {
        this.toastContainer = null;
    }

    async confirm(message, { defaultValue = false } = {}) {
        try {
            return window.confirm(message);
        } catch (_) {
            return defaultValue;
        }
    }

    async alert(message) {
        window.alert(message);
    }

    async prompt(message, defaultValue = "") {
        try {
            const result = window.prompt(message, defaultValue);
            return result === null ? null : result;
        } catch (_) {
            return null;
        }
    }

    showToast(message, { type = "info", duration = 3000 } = {}) {
        if (!message) {
            return;
        }

        if (!this.toastContainer) {
            this.toastContainer = document.createElement("div");
            this.toastContainer.className = "toast-container";
            document.body.appendChild(this.toastContainer);
        }

        const toast = document.createElement("div");
        toast.classList.add("timeout-toast", type);
        toast.innerHTML = `
            <div class="toast-left">
                <img src="./assets/icons/${type}.svg" alt="${type} icon" class="toast-icon">
                <span class="message-type">${type.charAt(0).toUpperCase() + type.slice(1)}:</span>
                <span class="toast-message">${message}</span>
            </div>
            <button class="close" aria-label="Close">
                <img class="close-icon" src="./assets/icons/x-mark.svg" alt="close">
            </button>
        `;

        const removeToast = () => {
            toast.remove();
            if (!this.toastContainer?.children.length) {
                this.toastContainer?.remove();
                this.toastContainer = null;
            }
        };

        const closeButton = toast.querySelector(".close");
        closeButton?.addEventListener("click", removeToast);
        this.toastContainer.appendChild(toast);
        window.setTimeout(removeToast, duration);
    }
}

const uiService = new UIService();
export default uiService;
