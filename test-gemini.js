const { GoogleGenAI } = require('@google/genai');

console.log('GoogleGenAI:', typeof GoogleGenAI);
console.log('GoogleGenAI constructor:', GoogleGenAI);

const gemini = new GoogleGenAI({
  apiKey: 'test-key'
});

console.log('gemini instance:', typeof gemini);
console.log('gemini methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(gemini)));
console.log('gemini properties:', Object.getOwnPropertyNames(gemini));

if (typeof gemini.getGenerativeModel === 'function') {
  console.log('getGenerativeModel exists');
} else {
  console.log('getGenerativeModel does NOT exist');
  console.log('Available methods:', Object.getOwnPropertyNames(gemini).filter(name => typeof gemini[name] === 'function'));
}




