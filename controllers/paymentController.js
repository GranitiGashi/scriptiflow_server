const supabase = require('../config/supabaseClient');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


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

        // 2. Validate and attach payment method to customer
        const pm = await stripe.paymentMethods.retrieve(payment_method_id);
        if (pm.customer && pm.customer !== customerId) {
            return res.status(400).json({ error: 'Payment method is already attached to another customer' });
        }
        try {
            await stripe.paymentMethods.attach(payment_method_id, { customer: customerId });
        } catch (attachErr) {
            if (!(attachErr && attachErr.code === 'resource_already_exists')) {
                throw attachErr;
            }
        }

        // 3. Set default payment method
        await stripe.customers.update(customerId, {
            invoice_settings: {
                default_payment_method: payment_method_id,
            },
        });

        // 4. Save only non-sensitive references in DB
        await supabase.from('user_payment_methods').upsert({
            user_id: userId,
            stripe_customer_id: customerId,
            payment_method_id,
            updated_at: new Date().toISOString(),
        });

        // 5. Return safe card metadata
        const updatedPm = await stripe.paymentMethods.retrieve(payment_method_id);
        const card = updatedPm.card || {};
        res.json({
            message: 'Payment method saved successfully',
            card: {
                brand: card.brand,
                last4: card.last4,
                exp_month: card.exp_month,
                exp_year: card.exp_year,
            },
        });
    } catch (err) {
        console.error('savePaymentMethod error:', err);
        res.status(500).json({ error: 'Failed to save payment method' });
    }
};


exports.getPaymentMethod = async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }
    const token = authHeader.split(' ')[1];

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        const userId = user.id;
        const { data, error: pmError } = await supabase
            .from('user_payment_methods')
            .select('stripe_customer_id, payment_method_id')
            .eq('user_id', userId)
            .single();

        if (pmError || !data?.payment_method_id) {
            return res.status(404).json({ error: 'No payment method found' });
        }

        const pm = await stripe.paymentMethods.retrieve(data.payment_method_id);
        const card = pm.card || {};
        return res.json({
            card: {
                brand: card.brand,
                last4: card.last4,
                exp_month: card.exp_month,
                exp_year: card.exp_year,
            },
        });
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
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        const userId = user.id;

        // Get existing payment method info
        const { data: existing, error: existingError } = await supabase
            .from('user_payment_methods')
            .select('stripe_customer_id')
            .eq('user_id', userId)
            .single();

        if (existingError || !existing?.stripe_customer_id) {
            return res.status(404).json({ error: 'No existing payment method' });
        }

        // Validate and attach
        const pm = await stripe.paymentMethods.retrieve(payment_method_id);
        if (pm.customer && pm.customer !== existing.stripe_customer_id) {
            return res.status(400).json({ error: 'Payment method is already attached to another customer' });
        }
        try {
            await stripe.paymentMethods.attach(payment_method_id, { customer: existing.stripe_customer_id });
        } catch (attachErr) {
            if (!(attachErr && attachErr.code === 'resource_already_exists')) {
                throw attachErr;
            }
        }

        await stripe.customers.update(existing.stripe_customer_id, {
            invoice_settings: { default_payment_method: payment_method_id },
        });

        // Update Supabase with only references
        await supabase
            .from('user_payment_methods')
            .update({ payment_method_id, updated_at: new Date().toISOString() })
            .eq('user_id', userId);

        const updatedPm = await stripe.paymentMethods.retrieve(payment_method_id);
        const card = updatedPm.card || {};
        res.json({
            message: 'Payment method updated',
            card: {
                brand: card.brand,
                last4: card.last4,
                exp_month: card.exp_month,
                exp_year: card.exp_year,
            },
        });
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
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        const userId = user.id;

        const { data: method, error: methodError } = await supabase
            .from('user_payment_methods')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (methodError || !method?.payment_method_id) return res.status(404).json({ error: 'No payment method found' });

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

// Create a SetupIntent to collect and save a card on the client using Stripe Elements
exports.createSetupIntent = async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }
    const token = authHeader.split(' ')[1];

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        const userId = user.id;

        // Ensure Stripe customer exists
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

        const setupIntent = await stripe.setupIntents.create({
            customer: customerId,
            usage: 'off_session',
        });

        res.json({ client_secret: setupIntent.client_secret });
    } catch (err) {
        console.error('createSetupIntent error:', err);
        res.status(500).json({ error: 'Failed to create setup intent' });
    }
};
