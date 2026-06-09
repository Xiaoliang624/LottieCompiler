import { createWorker } from 'tesseract.js';

async function recognize() {
  const worker = await createWorker('eng');
  const ret = await worker.recognize('/src/imports/image.png');
  console.log(ret.data.text);
  await worker.terminate();
}

recognize();