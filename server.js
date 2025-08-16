require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const socialRoutes = require('./routes/socialRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const mobileDeRoutes = require('./routes/mobiledeRoutes');
const adsRoutes = require('./routes/adsRoutes');


const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', authRoutes);
app.use('/api', socialRoutes);
app.use('/api', paymentRoutes);
app.use('/api', mobileDeRoutes);
app.use('/api', adsRoutes);

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));