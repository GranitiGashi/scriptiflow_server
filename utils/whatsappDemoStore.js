const store = {
  token: EAAZA4UT82JSoBPtZApMshmrXOjOSv6YV4bCfxiRZCH9AqeRd0tF87aFLG7OcIbaSyYww8ePva8ZCjLT4esvKTXRjArJzClJ9M7ZCofeZBOu5sPce1FS1z5cbtZC0Jgq4XfcY9hVfNm45SClSXFzFOirGhIKRyrCPWTnhgSRZBGuMQZAfMr085wewoCfZAkgK9OBKUUL0sqH4r5WtmcYEFwNdZCI76Y2kUrdEh8tuoA3MPICIJDVZA8wZD,
  phoneNumberId: 763481470187721,
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


