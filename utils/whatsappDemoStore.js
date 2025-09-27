 const store = {
   token: null,
   phoneNumberId: null,
  inbox: [
    {
      id: 'demo-1',
      from: '+15551655668',
      to: '+38345966101',
      body: 'Hi, I am interested in the C43 AMG. What is the price?',
      direction: 'inbound',
      ts: Date.now() - 60000,
    },
  ],
};

function setToken(token, phoneNumberId) {
  store.token = token;
  store.phoneNumberId = phoneNumberId || store.phoneNumberId || 'YOUR_PHONE_NUMBER_ID';
}

function getToken() {
  return { token: store.token, phoneNumberId: store.phoneNumberId };
}

function addMessage({ from, to, body, direction }) {
  store.inbox.push({ id: 'm-' + Date.now(), from, to, body, direction, ts: Date.now() });
}

function listMessages() {
  return store.inbox.slice(-50);
}

module.exports = { setToken, getToken, addMessage, listMessages };


