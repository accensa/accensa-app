- closes #372
- closes #362
- closes #357
- closes #352

This pull request improves the inline documentation and comments across multiple SDK files to provide a better developer experience and more precise API documentation. The specific changes made include:

1. **`receipt-anchor-client.ts` (Fixes #372):**
   - Added JSDoc comments to `DEFAULT_RPC_URL` and `DEFAULT_NETWORK_PASSPHRASE` exports.
   - Documented the fields of the `BatchRecord` interface.
   - Added comprehensive parameter (`@param`) and return type (`@returns`) annotations for the `ReceiptAnchorClient` constructor, `verifyReceiptOnChain`, `getBatch`, and `simulate` methods.

2. **`tsup.config.ts` (Fixes #362):**
   - Expanded the documentation for `baseOptions` by adding inline comments to each configuration property (`format`, `dts`, `outDir`, `splitting`, `sourcemap`, `target`, `treeshake`, `minify`) to explain why they are set.
   - Added descriptive block comments above the main `defineConfig` array and detailed inline comments for individual entry point configurations (such as `entry` and `banner`).

3. **`vectors.rs` (Fixes #357):**
   - Added Rust doc comments (`///`) to `pub struct Vector` and each of its fields (`name`, `leaf`, `proof`, `root`, `expected`) to clarify the purpose and structure of these test vectors in verifying Merkle tree proofs.

4. **`webhooks.ts` (Fixes #352):**
   - Added a missing `@returns` directive to the `verifyWebhookSignature` method's JSDoc block.
   - Added inline comments inside the body of `verifyWebhookSignature` to explain the logic flow, including the early returns, buffer conversion within the try-catch block, and the timing-safe equality check.
