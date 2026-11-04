Drashti offline helper resources

intfloat/multilingual-e5-small: MIT, original publisher's quantized ONNX encoder.
Model: 118346824 bytes. Tokenizer plus configurations: 17083828 bytes.
Revision 614241f622f53c4eeff9890bdc4f31cfecc418b3. See model-MIT.txt.

@huggingface/tokenizers 0.2.0: Apache-2.0. See tokenizers-Apache-2.0.txt.
ONNX Runtime Node.js/common 1.30.0: MIT. Intel Mac: 1.23.2, as 1.30.0 does
not distribute an Intel Mac binary. See onnxruntime-MIT.txt.
The package's installer is not executed; only the matching platform binaries
are bundled. Drashti explicitly selects the CPU execution provider and one
inference thread. GPU/download installer dependencies are not installed.

scripts/fetch-ai-models.mjs pins every downloaded asset by SHA-256, prepares
one target at a time and writes a SOURCE.json file containing each final
file's size and SHA-256. Its --offline option requires the verified cache.
No account, cloud inference, network inference or user content is needed.
