const workspaceModule = assistOS.loadModule("workspace");
import {
    attachEventListeners, constructFullExpression,
    openSearchSelect,
    selectOption
} from "../edit-variable-tab/varUtilsUI.js";
export class AddVariable {
    constructor(element, invalidate) {
        this.invalidate = invalidate;
        this.element = element;
        this.documentId = this.element.getAttribute("data-document-id");
        this.chapterId = this.element.getAttribute("data-chapter-id");
        this.paragraphId = this.element.getAttribute("data-paragraph-id");
        this.documentPresenter = document.querySelector("document-view-page").webSkelPresenter;
        this.document = this.documentPresenter._document;
        if(this.chapterId){
            this.chapter = this.document.chapters.find(chapter => chapter.id === this.chapterId);
        }
        if(this.paragraphId){
            this.paragraph = this.chapter.paragraphs.find(paragraph => paragraph.id === this.paragraphId);
        }
        this.element.classList.add("maintain-focus");
        this.invalidate();
    }
    async beforeRender(){
        this.commands = await workspaceModule.getCommands();
        this.commands.sort();
    }
    changeExpressionInputToMultiLine(){
        let expressionInput = this.element.querySelector(".expression-input");
        expressionInput.classList.add("hidden");
        expressionInput.name = "";
        expressionInput.id = "";
        let expressionTextarea = this.element.querySelector(".expression-multi-line");
        expressionTextarea.classList.remove("hidden");
        expressionTextarea.name = "expression";
        expressionTextarea.id = "expression";
        let parametersInput = this.element.querySelector(".multi-line-expr-parameters");
        parametersInput.classList.remove("hidden");
    }
    changeMultiLineToSingleLine(){
        let expressionInput = this.element.querySelector(".expression-input");
        expressionInput.classList.remove("hidden");
        expressionInput.name = "expression";
        expressionInput.id = "expression";
        let expressionTextarea = this.element.querySelector(".expression-multi-line");
        expressionTextarea.classList.add("hidden");
        expressionTextarea.name = "";
        expressionTextarea.id = "";
        let parametersInput = this.element.querySelector(".multi-line-expr-parameters");
        parametersInput.classList.add("hidden");
    }
    async afterRender(){
        let types = await workspaceModule.getCustomTypes();
        let variableTypeOptions = [{name: "Select a type", value: ""}];
        for(let type of types){
            variableTypeOptions.push({
                name: type,
                value: type
            })
        }
        assistOS.UI.createElement("custom-select", ".select-type-container", {
                options: variableTypeOptions,
            },
            {
                "data-width": "230",
                "data-name": "type",
                "data-selected": "",
            })
        let commandInput = this.element.querySelector("#command");
        commandInput.value = "assign";
        attachEventListeners(this);
    }
    /*search select*/
    openSearchSelect(){
        openSearchSelect(this);
    }
    selectOption(option){
        selectOption(this, option);
    }
    /*search select*/
    async addVariable(button){
        try {
            let result = constructFullExpression(this);
            button.classList.add("disabled");
            if(!result.ok){
                return;
            }
            if(this.paragraphId){
                this.paragraph.commands = `${this.paragraph.commands || ""}${result.fullExpression}\n`;
                this.paragraph.metadata = {
                    ...(this.paragraph.metadata || {}),
                    commands: this.paragraph.commands
                };
                await this.documentPresenter.updateParagraphModel(this.chapterId, this.paragraphId, {
                    text: this.paragraph.text,
                    commands: this.paragraph.commands,
                    comments: this.paragraph.comments,
                    metadata: this.paragraph.metadata
                });
            } else if(this.chapterId){
                this.chapter.commands = `${this.chapter.commands || ""}${result.fullExpression}\n`;
                this.chapter.metadata = {
                    ...(this.chapter.metadata || {}),
                    commands: this.chapter.commands
                };
                await this.documentPresenter.updateChapterModel(this.chapterId, {
                    title: this.chapter.title,
                    commands: this.chapter.commands,
                    comments: this.chapter.comments,
                    metadata: this.chapter.metadata
                });
            } else {
                this.document.commands = `${this.document.commands || ""}${result.fullExpression}\n`;
                this.document.metadata = {
                    ...(this.document.metadata || {}),
                    commands: this.document.commands
                };
                await this.documentPresenter.updateDocumentModel({
                    title: this.document.title,
                    docId: this.document.docId,
                    infoText: this.document.infoText,
                    commands: this.document.commands,
                    comments: this.document.comments,
                    metadata: this.document.metadata
                });
            }
            await this.documentPresenter?.refreshVariables?.();
            this.documentPresenter?.notifyObservers?.("variables");
            await assistOS.UI.closeModal(this.element, true);
        } catch (e) {
            assistOS.showToast(e.message, "error", 7000);
            throw e;
        } finally {
            button.classList.remove("disabled");
        }

    }
    async closeModal(){
        await assistOS.UI.closeModal(this.element);
    }
}
