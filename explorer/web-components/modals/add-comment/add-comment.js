import {generateId} from "../../../imports.js";

const LOCAL_SHIM_EMAIL = 'local@example.com';

function getCurrentCommentUser() {
    const user = assistOS?.user || {};
    const email = String(user.email || '').trim();
    const userName = String(user.username || user.name || user.displayName || '').trim();
    const author = {};
    if (userName) {
        author.userName = userName;
    }
    if (email && email !== LOCAL_SHIM_EMAIL) {
        author.userEmail = email;
    }
    const imageId = String(user.imageId || '').trim();
    if (imageId) {
        author.userImageId = imageId;
    }
    return author;
}

export class AddComment {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.element.classList.add('maintain-focus');
        this.invalidate();
    }

    beforeRender() {

    }

    afterRender() {
        this.textArea = this.element.querySelector('#comment');
        let addCommentButton = this.element.querySelector('.add-comment');
        this.textArea.addEventListener('input', (e) =>{
            if(e.target.value.trim() === ""){
                addCommentButton.classList.add("disabled");
            } else{
                addCommentButton.classList.remove("disabled");
            }
        });

    }

    closeModal(_target) {
        assistOS.UI.closeModal(_target);
    }

    async addComment(_target) {
        const currentUser = getCurrentCommentUser();
        let message = {
            id: generateId(8),
            ...currentUser,
            message: this.textArea.value
        };
        assistOS.UI.closeModal(_target, message);
    }
}
