require('dotenv').config();
const fs = require('fs');
const { Connection, Keypair, PublicKey, Transaction } = require('@solana/web3.js');
const { getOrCreateAssociatedTokenAccount, transfer, createTransferInstruction } = require('@solana/spl-token');

// Initialize Solana connection
const connection = new Connection(process.env.RPC_URL, 'confirmed');

// Load the airdrop account private key securely
const airdropPrivateKeyPath = process.env.AIRDROP_PRIVATE_KEY_FILE || './secrets/airdrop_private_key.json';
const airdropPrivateKey = Uint8Array.from(JSON.parse(fs.readFileSync(airdropPrivateKeyPath, 'utf8')));
const airdropAccount = Keypair.fromSecretKey(airdropPrivateKey);

/**
 * Generate an array of random public keys for testing.
 * @param {number} count - The number of public keys to generate.
 * @returns {string[]} - Array of public keys in Base58 format.
 */
function generateRandomPublicKeys(count) {
  return Array.from({ length: count }, () => Keypair.generate().publicKey.toBase58());
}

/**
 * Retry an asynchronous operation with a set number of retries.
 * @param {Function} operation - The operation to retry.
 * @param {number} maxRetries - Maximum number of retry attempts.
 * @param {number} delay - Delay between retries in milliseconds.
 * @returns {Promise<any>} - The result of the operation.
 */
async function retryOperation(operation, maxRetries = 5, delay = 1000) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      console.error(`Attempt ${attempt} failed. Retrying...`, error);
      if (attempt >= maxRetries) throw new Error(`Max retries reached: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Distribute tokens to multiple recipients in batches.
 * @param {PublicKey} mintPublicKey - The mint address of the SPL token.
 * @param {Keypair} airdropAccount - The account holding the tokens for distribution.
 * @param {string[]} recipientAddresses - Array of recipient wallet public keys in Base58 format.
 * @param {number} amountPerRecipient - Amount of tokens to transfer to each recipient.
 */
async function distributeTokensToRecipients(mintPublicKey, airdropAccount, recipientAddresses, amountPerRecipient) {
  // Fetch the airdrop account's associated token account (ATA)
  const airdropTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    airdropAccount,
    mintPublicKey,
    airdropAccount.publicKey
  );

  const batchSize = 10; // Number of instructions per transaction
  let transaction = new Transaction();

  for (let i = 0; i < recipientAddresses.length; i++) {
    const recipientWallet = new PublicKey(recipientAddresses[i]);

    // Derive or create the recipient's ATA
    const { address: recipientTokenAccount } = await getOrCreateAssociatedTokenAccount(
      connection,
      airdropAccount,
      mintPublicKey,
      recipientWallet
    );

    // Add a transfer instruction for this recipient
    transaction.add(
      createTransferInstruction(
        airdropTokenAccount.address, // Source token account
        recipientTokenAccount,       // Destination ATA
        airdropAccount.publicKey,    // Authority for the source account
        amountPerRecipient           // Amount to transfer
      )
    );

    // Send the transaction if the batch is full or if it's the last recipient
    if ((i + 1) % batchSize === 0 || i === recipientAddresses.length - 1) {
      const txSignature = await retryOperation(() =>
        connection.sendTransaction(transaction, [airdropAccount], {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        })
      );

      console.log(`Transaction Signature: ${txSignature}`);
      console.log(`Processed batch of recipients (Batch size: ${Math.min(batchSize, (i + 1) % batchSize == 0 ? batchSize : (i + 1) % batchSize)})`);

      // Reset the transaction for the next batch
      transaction = new Transaction();
    }
  }
}

/**
 * Check the balance of the airdrop account's associated token account.
 * @param {PublicKey} mintPublicKey - The mint address of the SPL token.
 * @returns {number} - The balance in raw token units (lamports).
 */
async function checkAirdropTokenAccountBalance(mintPublicKey) {
  const airdropTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    airdropAccount,
    mintPublicKey,
    airdropAccount.publicKey
  );

  const balance = await connection.getTokenAccountBalance(airdropTokenAccount.address);
  console.log(`Airdrop Token Account Balance: ${balance.value.uiAmount} tokens (${balance.value.amount} lamports)`);
  return parseInt(balance.value.amount, 10);
}

/**
 * Main function to execute the airdrop.
 */
async function airDrop(mintAddress, recipientAccounts, amountPerRecipient) {
  try {
    const mintPublicKey = new PublicKey(mintAddress);

    // Distribute tokens
    await distributeTokensToRecipients(mintPublicKey, airdropAccount, recipientAccounts, amountPerRecipient);

    console.log('Airdrop completed successfully.');
  } catch (error) {
    console.error('Error during airdrop process:', error);
  }
}

/**
 * Entry point of the script.
 */
async function main() {
  const mintAddress = "CMBRNF6yFkT76b92WEAnbnK816ruDpgNC3oiky74JWwH"; // Replace with your token mint address
  const recipientAccounts = generateRandomPublicKeys(24); // Generate 30 random recipient accounts
  const amountPerRecipient = 100000000; // Tokens to send to each recipient

  // Check airdrop account's token balance
  const balance = await checkAirdropTokenAccountBalance(new PublicKey(mintAddress));
  console.log(`Balance in airdrop account: ${balance} lamports`);

  if (balance < amountPerRecipient * recipientAccounts.length) {
    throw new Error("Insufficient tokens in the airdrop account.");
  }

  // Execute the airdrop
  await airDrop(mintAddress, recipientAccounts, amountPerRecipient);
}

// Run the main function
main().catch(console.error);




