const clock = document.querySelector('#chicago-clock');
const timeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true,
});
function updateClock() { clock.textContent = timeFormat.format(new Date()); }
updateClock();
setInterval(updateClock, 1000);

const form = document.querySelector('#contact-form');
const sendButton = form.querySelector('button');
const status = document.querySelector('#form-status');
let sending = false;
function updateButton() {
  const fields = [...form.querySelectorAll('[required]')];
  sendButton.disabled = sending || !fields.every(field => field.validity.valid && field.value.trim())
    || form.elements.message.value.trim().length < 10;
}
form.addEventListener('input', () => {
  updateButton();
  if (!sending) status.textContent = '';
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (sending || !form.reportValidity() || sendButton.disabled) return;
  sending = true;
  updateButton();
  sendButton.textContent = 'sending…';
  status.textContent = '';
  const data = Object.fromEntries(new FormData(form));
  try {
    const response = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to send. Please try again.');
    form.reset();
    status.textContent = 'message sent. thank you!';
  } catch (error) {
    status.textContent = error instanceof SyntaxError || error.name === 'TypeError' || error.name === 'TimeoutError'
      ? 'Unable to confirm sending. Please try later or use the email link.'
      : error.message;
  } finally {
    sending = false;
    sendButton.textContent = 'send';
    updateButton();
  }
});
