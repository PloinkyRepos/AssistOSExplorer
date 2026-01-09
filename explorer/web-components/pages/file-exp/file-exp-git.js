export function attachGitController(fileExp) {
    async function openGitModal() {
        const repoPath = '/.ploinky/repos';
        return fileExp.withLoader(async () => {
            await assistOS.UI.createReactiveModal('git-commit-modal', { repoPath });
        });
    }

    Object.assign(fileExp, { openGitModal });
}
