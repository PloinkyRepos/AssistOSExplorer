const galleryModule = assistOS.loadModule("gallery");
const workspaceModule = assistOS.loadModule("workspace");

export class InsertImageModal {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.modalBody = `
            <div class="modal-body">
                <button data-local-action="openGallerySection">From Gallery</button>
                <button data-local-action="openMyDevice">My device</button data-local-action="openMyDevice">
                <input type="file" id="file" class="hidden" accept="image/*">
            </div>`;
        this.invalidate(async () => {
            this.galleries = await galleryModule.getGalleriesMetadata();
        });
        this.selectedImage = "";
        this.element.classList.add("maintain-focus");
        this.element.classList.add("insert-modal");
    }

    beforeRender() {
        this.generateSection = `
        <form class="modal-body generate-section">
            <div class="form-item">
                <label class="modal-label" for="prompt">Prompt</label>
                <textarea class="form-input" name="prompt" id="prompt" data-id="prompt"></textarea>
            </div>
            <div class="modal-actions">
                <button type="button" class="general-button" data-local-action="changePersonality">Generate image</button>
            </div>
        </form>`;
        let galleriesHMTL = "";
        if (this.galleries.length > 0) {
            this.galleries.forEach((gallery) => {
                galleriesHMTL += `<gallery-item data-name="${gallery.config.name}" 
                data-id="${gallery.id}" data-local-action="openGallery ${gallery.id}"></gallery-item>`;
            });
        } else {
            galleriesHMTL = `<div> There are no galleries yet </div>`;
        }
        this.gallerySection = `
        <div class="modal-body gallery-section">
         ${galleriesHMTL}
        </div>`;
    }

    afterRender() {
    }

    openGallerySection() {
        this.modalBody = this.gallerySection;
        this.invalidate();
    }

    closeModal(_target) {
        if(this.imgElement){
            this.imgElement.remove();
        }
        assistOS.UI.closeModal(_target);
    }

    async openGallery(_target, galleryId) {
        this.selectedGallery = await galleryModule.getGallery(galleryId);
        let allImages = this.selectedGallery.openAIHistory.concat(this.selectedGallery.midjourneyHistory);
        allImages.sort((a, b) => {
            return new Date(b.createdAt) - new Date(a.createdAt);
        });
        this.allImages = allImages.filter((image) => image.saved);
        let stringHTML = "";
        for (let image of this.allImages) {
            stringHTML += `
            <div class="img-container">
                <img class="gallery-image" src="${image.src}" alt="${image.timestamp}" id="${image.id}" data-local-action="selectGalleryImage ${image.id}">
                <input type="checkbox" class="image-checkbox">
            </div>
            `;
        }
        this.galleryImagesSection = `
        <div class="modal-body gallery-images">
            <div class="images-grid">
                 ${stringHTML}
            </div>
            <div class="modal-actions">
                <button type="button" class="general-button" data-local-action="insertImages">Insert</button>
            </div>
        </div>`;
        this.modalBody = this.galleryImagesSection;
        this.invalidate();
    }

    insertImages(_target) {
        assistOS.UI.closeModal(_target, this.selectedImage);
    }

    selectGalleryImage(targetElement, imageId) {
        if (!imageId) return;
        const imgContainer = targetElement.parentElement;
        if (!imgContainer) return;
        const image = this.allImages.find((img) => img.id === imageId);
        const checkbox = imgContainer.querySelector(".image-checkbox");
        targetElement.classList.toggle("selected-image");
        if (imgContainer.classList.contains("selected")) {
            imgContainer.classList.remove("selected");
            if (checkbox) {
                checkbox.checked = false;
                checkbox.style.visibility = "hidden";
            }
            this.selectedImage = "";
            return;
        }
        imgContainer.classList.add("selected");
        if (checkbox) {
            checkbox.checked = true;
            checkbox.style.visibility = "visible";
        }
        if (this.selectedImage) {
            const selectedImg = this.element.querySelector(`#${this.selectedImage.id}`);
            const selectedImgContainer = selectedImg?.parentElement;
            if (selectedImgContainer) {
                selectedImgContainer.classList.remove("selected");
                const previousCheckbox = selectedImgContainer.querySelector(".image-checkbox");
                if (previousCheckbox) {
                    previousCheckbox.checked = false;
                    previousCheckbox.style.visibility = "hidden";
                }
            }
        }
        this.selectedImage = image || "";
    }

    openMyDevice(_target) {
        let fileInput = this.element.querySelector("#file");
        fileInput.click();
        if (!this.boundFileHandler) {
            this.boundFileHandler = this.selectFileHandler.bind(this, _target);
            fileInput.addEventListener("change", this.boundFileHandler);
        }
    }

    selectFileHandler(_target, event) {
        let file = event.target.files[0];
        let reader = new FileReader();
        this.imgElement = new Image();
        reader.onload = async (e) => {
            const uint8Array = new Uint8Array(e.target.result);
            let imageId = await workspaceModule.putImage(uint8Array);
            reader.onload = async (e) => {
                this.imgElement.onload = async () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = this.imgElement.width;
                    canvas.height = this.imgElement.height;
                    ctx.drawImage(this.imgElement, 0, 0);
                    canvas.remove();
                    await assistOS.loadifyComponent(this.element, async () => {
                        const width = this.imgElement.width;
                        const height = this.imgElement.height;
                        let data = {
                            id: imageId,
                            width: width,
                            height: height
                        };
                        assistOS.UI.closeModal(_target, data);
                    });
                };
                this.imgElement.src = e.target.result;
            };
            reader.readAsDataURL(file);

        }
        reader.readAsArrayBuffer(file);
    }

}
