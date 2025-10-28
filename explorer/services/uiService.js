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
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        this.toastContainer.appendChild(toast);

        window.setTimeout(() => {
            toast.classList.add("toast-hide");
            toast.addEventListener("transitionend", () => {
                toast.remove();
                if (!this.toastContainer.children.length) {
                    this.toastContainer.remove();
                    this.toastContainer = null;
                }
            });
        }, duration);
    }
}

const uiService = new UIService();
export default uiService;
