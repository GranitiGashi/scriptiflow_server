const { runOnce: runSocial } = require('./socialPoster');
const { runOnce: runImages } = require('./imageProcessor');

async function loop() {
  try {
    await Promise.all([
      runImages(10),
      runSocial(5),
    ]);
  } catch (e) {}
  setTimeout(loop, 5000);
}

loop();
