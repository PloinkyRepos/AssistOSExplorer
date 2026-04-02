export class VariableValuesTab {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.documentId = this.element.getAttribute("data-document-id") || null;
        let documentPresenter = document.querySelector("document-view-page").webSkelPresenter;
        this.document = documentPresenter._document;
        this.element.classList.add("maintain-focus");
        this.varName = this.element.getAttribute("data-name");
        this.variable = documentPresenter.variables.find(variable => variable.varName === this.varName) || null;
        this.loadError = null;
        this.loaded = false;
        this.invalidate();
    }
    async beforeRender() {
        if (this.loaded) {
            return;
        }
        this.loaded = true;
        if (!window.assistOS?.appServices?.callTool) {
            return;
        }
        if (!this.documentId && this.document?.docId) {
            this.documentId = this.document.docId;
        }
        if (!this.documentId) {
            this.loadError = new Error("Missing documentId for variable lookup");
            return;
        }
        try {
            const result = await window.assistOS.appServices.callTool("soplangAgent", "get_variable_with_value", {
                documentId: this.documentId,
                varName: this.varName
            });
            const payload = result?.json ?? (typeof result?.text === "string" ? JSON.parse(result.text) : null);
            if (payload) {
                this.variable = payload;
            }
        } catch (error) {
            this.loadError = error;
        }
    }
    afterRender() {
        let valueInput = this.element.querySelector("#value");
        if (this.variable && typeof this.variable.value === "object") {
            valueInput.value = JSON.stringify(this.variable.value, null, 2);
        } else {
            valueInput.value = this.variable?.value ?? "";
        }
        let errorsInput = this.element.querySelector("#errors");
        errorsInput.value = this.loadError?.message || this.variable?.errorInfo || "";
    }
}
