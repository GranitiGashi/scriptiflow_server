const supabase = require('../config/supabaseClient');
const Stripe = require('stripe');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { verifyToken } = require('../utils/jwtUtils');
const jwt = require('jsonwebtoken');


exports.savePaymentMethod = async (req, res) => {
    try {
        const token = req.headers.authorization?.replace("Bearer ", "");
        const { payment_method_id } = req.body;

        if (!payment_method_id) {
            return res.status(400).json({ error: 'Missing payment_method_id in request body' });
        }
        if (!token) {
            return res.status(401).json({ error: 'Missing token' });
        }

        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        const userId = user.id;

        // 1. Get or create Stripe customer
        const { data: profile, error: profileError } = await supabase
            .from('user_payment_methods')
            .select('stripe_customer_id')
            .eq('user_id', userId)
            .single();

        if (profileError && profileError.code !== 'PGRST116') {
            throw profileError;
        }

        let customerId = profile?.stripe_customer_id;

        if (!customerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                metadata: { supabase_user_id: userId },
            });
            customerId = customer.id;

            await supabase.from('user_payment_methods').upsert({
                user_id: userId,
                stripe_customer_id: customerId,
            });
        }

        // 2. Attach payment method to customer
        const attached = await stripe.paymentMethods.attach(payment_method_id, {
            customer: customerId,
        });

        // 3. Set default payment method
        await stripe.customers.update(customerId, {
            invoice_settings: {
                default_payment_method: payment_method_id,
            },
        });

        // 4. Save in DB
        await supabase.from('user_payment_methods').upsert({
            user_id: userId,
            stripe_customer_id: customerId,
            payment_method_id,
            updated_at: new Date().toISOString(),
        });

        res.json({ message: 'Payment method saved successfully' });
    } catch (err) {
        console.error('savePaymentMethod error:', err);
        res.status(500).json({ error: err.message || 'Failed to save payment method' });
    }
};


exports.getPaymentMethod = async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }
    const token = authHeader.split(' ')[1];

    try {
        const decoded = verifyToken(token);
        const userId = decoded.user_id;

        const { data, error } = await supabase
            .from('user_payment_methods')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error) return res.status(404).json({ error: 'No payment method found' });

        res.json(data);
    } catch (err) {
        console.error('getPaymentMethod error:', err);
        res.status(500).json({ error: 'Failed to fetch payment method' });
    }
};

exports.updatePaymentMethod = async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }
    const token = authHeader.split(' ')[1];
    const { payment_method_id } = req.body;

    try {
        const decoded = verifyToken(token);
        const userId = decoded.user_id;

        // Get existing payment method info
        const { data: existing, error: existingError } = await supabase
            .from('user_payment_methods')
            .select('stripe_customer_id')
            .eq('user_id', userId)
            .single();

        if (existingError) return res.status(404).json({ error: 'No existing payment method' });

        // Update Stripe payment method
        await stripe.paymentMethods.attach(payment_method_id, {
            customer: existing.stripe_customer_id,
        });

        await stripe.customers.update(existing.stripe_customer_id, {
            invoice_settings: { default_payment_method: payment_method_id },
        });

        // Update Supabase
        await supabase
            .from('user_payment_methods')
            .update({ payment_method_id, updated_at: new Date().toISOString() })
            .eq('user_id', userId);

        res.json({ message: 'Payment method updated' });
    } catch (err) {
        console.error('updatePaymentMethod error:', err);
        res.status(500).json({ error: 'Failed to update payment method' });
    }
};

exports.deletePaymentMethod = async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }
    const token = authHeader.split(' ')[1];

    try {
        const decoded = verifyToken(token);
        const userId = decoded.user_id;

        const { data: method, error: methodError } = await supabase
            .from('user_payment_methods')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (methodError) return res.status(404).json({ error: 'No payment method found' });

        // Detach payment method from Stripe
        await stripe.paymentMethods.detach(method.payment_method_id);

        // Delete record from Supabase
        await supabase
            .from('user_payment_methods')
            .delete()
            .eq('user_id', userId);

        res.json({ message: 'Payment method deleted' });
    } catch (err) {
        console.error('deletePaymentMethod error:', err);
        res.status(500).json({ error: 'Failed to delete payment method' });
    }
};
