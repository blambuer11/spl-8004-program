import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { KoraClient } from './koraClient.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Configuration
const PORT = Number(process.env.PORT || 3001);
const KORA_RPC_URL = process.env.KORA_RPC_URL || 'http://localhost:8090';
const KORA_API_KEY = process.env.KORA_API_KEY || 'kora_facilitator_api_key';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const NETWORK = process.env.NETWORK || 'solana-devnet';
const USDC_MINT = process.env.USDC_MINT || 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';
const MOCK_MODE = process.env.MOCK_MODE === 'true';

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
const koraClient = new KoraClient(KORA_RPC_URL, KORA_API_KEY, MOCK_MODE);

/**
 * X402 Payment Payload Interface
 */
interface X402PaymentPayload {
  version: string;
  network: string;
  transaction: string; // Base64 encoded transaction
  metadata?: {
    endpoint: string;
    amount: string;
    recipient: string;
  };
}

/**
 * POST /verify
 * Verify payment transaction without broadcasting
 */
app.post('/verify', async (req: Request, res: Response) => {
  try {
    const payload: X402PaymentPayload = req.body;

    console.log('📝 Verifying payment:', payload.metadata);

    // Validate payload
    if (!payload.transaction) {
      return res.status(400).json({
        isValid: false,
        error: 'Missing transaction data',
      });
    }

    if (!payload.metadata) {
      return res.status(400).json({
        isValid: false,
        error: 'Missing payment metadata',
      });
    }

    // Decode transaction (best-effort). If parsing fails, fall back to Kora validation
    const transactionBuffer = Buffer.from(payload.transaction, 'base64');
    let transaction: Transaction | VersionedTransaction | undefined;
    let parsedOk = false;

    try {
      transaction = Transaction.from(transactionBuffer);
      parsedOk = true;
    } catch {
      try {
        transaction = VersionedTransaction.deserialize(transactionBuffer);
        parsedOk = true;
      } catch (error: any) {
        console.warn('⚠️ Could not parse transaction locally, will defer to Kora validation');
      }
    }

    // Validate amount
    const expectedAmount = parseFloat(payload.metadata.amount);
    if (expectedAmount <= 0 || isNaN(expectedAmount)) {
      return res.status(400).json({
        isValid: false,
        error: 'Invalid payment amount',
      });
    }

    // Verify with Kora (sign without broadcasting)
    try {
      await koraClient.signTransaction(payload.transaction);
    } catch (error: any) {
      console.error('❌ Kora verification failed:', error.message);
      return res.json({
        isValid: false,
        error: 'Transaction validation failed',
        details: MOCK_MODE ? error.message : undefined,
      });
    }

    console.log('✅ Payment verified');

    res.json({
      isValid: true,
      network: payload.network,
      amount: payload.metadata.amount,
      recipient: payload.metadata.recipient,
      parsed: parsedOk,
    });

  } catch (error: any) {
    console.error('❌ Verification error:', error);
    res.status(500).json({
      isValid: false,
      error: error.message,
    });
  }
});

/**
 * POST /settle
 * Sign and broadcast payment transaction
 */
app.post('/settle', async (req: Request, res: Response) => {
  try {
    const payload: X402PaymentPayload = req.body;

    console.log('💰 Settling payment:', payload.metadata);

    if (!payload.transaction) {
      return res.status(400).json({
        success: false,
        error: 'Missing transaction data',
      });
    }

    // Sign and send via Kora (gasless)
    const signature = await koraClient.signAndSendTransaction(payload.transaction);

    console.log('✅ Payment settled:', signature);

    res.json({
      success: true,
      signature,
      network: payload.network,
      explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${NETWORK.replace('solana-', '')}`,
    });

  } catch (error: any) {
    console.error('❌ Settlement error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /supported
 * Advertise facilitator capabilities
 */
app.get('/supported', async (req: Request, res: Response) => {
  try {
    const feePayer = MOCK_MODE
      ? (process.env.KORA_SIGNER_ADDRESS || 'MockPayerAddress11111111111111111111111111')
      : await koraClient.getPayerSigner().catch(() => 'UnknownPayerAddress');

    res.json({
      version: '0.0.1',
      network: NETWORK,
      paymentScheme: 'exact',
      feePayer,
      tokens: [
        {
          mint: USDC_MINT,
          symbol: 'USDC',
          decimals: 6,
        },
      ],
      endpoints: {
        verify: '/verify',
        settle: '/settle',
      },
    });
  } catch (error: any) {
    console.error('❌ Error in /supported:', error);
    res.status(500).json({
      error: error.message,
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    service: 'spl-8004-x402-facilitator',
    mockMode: MOCK_MODE,
    network: NETWORK,
  });
});

/**
 * POST /payment
 * Direct payment endpoint for testing (returns 200 with payment confirmation)
 */
app.post('/payment', async (req: Request, res: Response) => {
  try {
    const { recipient, amount, memo } = req.body;
    
    console.log('💳 Direct payment request:', { recipient, amount, memo });
    
    if (!recipient || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing recipient or amount',
      });
    }

    // In a real implementation, this would:
    // 1. Create USDC transfer transaction
    // 2. Sign with Kora
    // 3. Broadcast to Solana
    // For now, return mock success
    
    const mockSignature = `Mock${Date.now()}${Math.random().toString(36).slice(2)}`;
    
    console.log('✅ Payment processed (mock):', mockSignature);
    
    res.json({
      success: true,
      signature: mockSignature,
      network: NETWORK,
      amount: amount,
      recipient: recipient,
      memo: memo || '',
      explorerUrl: `https://explorer.solana.com/tx/${mockSignature}?cluster=${NETWORK.replace('solana-', '')}`,
    });
    
  } catch (error: any) {
    console.error('❌ Payment error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Error handling middleware
 */
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('💥 Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

/**
 * Start server
 */
app.listen(PORT, () => {
  console.log('\n🚀 SPL-8004 X402 Facilitator');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📡 Server running on http://localhost:${PORT}`);
  console.log(`🌐 Network: ${NETWORK}`);
  console.log(`🔗 Solana RPC: ${SOLANA_RPC_URL}`);
  console.log(`🔑 Kora RPC: ${KORA_RPC_URL}`);
  console.log(`🧪 Mock Mode: ${MOCK_MODE ? 'ENABLED' : 'DISABLED'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});
