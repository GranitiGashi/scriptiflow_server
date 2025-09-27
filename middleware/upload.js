const multer = require('multer');

// Use memory storage to avoid relying on local filesystem (Render ephemeral FS)
const storage = multer.memoryStorage();

// File filter (optional)
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPG, JPEG, and PNG are allowed.'));
  }
};

const upload = multer({
  storage,
  fileFilter
});

module.exports = upload;
