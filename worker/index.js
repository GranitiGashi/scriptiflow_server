const { runOnce: runSocial } = require('./socialPoster');
const { runOnce: runImages } = require('./imageProcessor');

async function loop() {
  try {
    await Promise.all([
      runImages(parseInt(process.env.IMAGE_WORKER_BATCH || '3', 10)),
      runSocial(5),
    ]);
  } catch (e) {}
  const delay = parseInt(process.env.IMAGE_WORKER_INTERVAL_MS || '4000', 10);
  setTimeout(loop, delay);
}

loop();
