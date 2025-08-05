require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const socialRoutes = require('./routes/socialRoutes');
const paymentRoutes = require('./routes/paymentRoutes');



const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', authRoutes);
app.use('/api', socialRoutes);
app.use('/api', paymentRoutes);

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));