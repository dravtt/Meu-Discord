const tips = [
  'Dica: use Shift + Enter para quebrar linha.',
  'Dica: seta para cima edita sua última mensagem.',
  'Dica: segure Shift ao apagar para pular a confirmação.',
  'Dica: ||texto|| esconde um spoiler.',
  'Dica: arraste arquivos para o chat para enviá-los.',
  'Dica: crie tópicos para conversas paralelas.',
];
document.getElementById('tip').textContent = tips[Math.floor(Math.random() * tips.length)];
const status = document.getElementById('status');
const retry = document.getElementById('retry');
window.splash.onStatus(({ text, failed }) => {
  status.textContent = text;
  retry.style.display = failed ? 'inline-block' : 'none';
});
retry.addEventListener('click', () => window.splash.retry());
