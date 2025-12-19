import fs from 'fs';
import * as readline from 'readline';
import path from 'path';

// Helper to ask question using an existing interface
function askQuestion(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, (ans) => {
    resolve(ans);
  }));
}

async function generateAndSaveImage() {
  console.log('\nAntigravity Image Generator');
  console.log('---------------------------');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const prompt = await askQuestion(rl, 'Enter your image prompt: ');
    if (!prompt.trim()) {
      console.log('Prompt cannot be empty.');
      rl.close();
      return;
    }

    // Aspect Ratio Selection
    console.log('\nSelect Aspect Ratio:');
    console.log('1. 16:9 (Default)');
    console.log('2. 1:1');
    console.log('3. 4:3');
    console.log('4. 3:4');
    console.log('5. 9:16');
    
    const arChoice = await askQuestion(rl, 'Choice [1]: ');
    let aspectRatio = "16:9";
    switch(arChoice.trim()) {
        case '2': aspectRatio = "1:1"; break;
        case '3': aspectRatio = "4:3"; break;
        case '4': aspectRatio = "3:4"; break;
        case '5': aspectRatio = "9:16"; break;
        default: aspectRatio = "16:9"; break;
    }

    // Resolution Selection
    console.log('\nSelect Resolution/Size:');
    console.log('1. 4K (Default)');
    console.log('2. 1024x1024');
    console.log('3. 2048x2048');
    
    const sizeChoice = await askQuestion(rl, 'Choice [1]: ');
    let imageSize = "4K";
    switch(sizeChoice.trim()) {
        case '2': imageSize = "1024x1024"; break;
        case '3': imageSize = "2048x2048"; break;
        default: imageSize = "4K"; break;
    }

    rl.close();

    console.log(`\nGenerating image with properties:`);
    console.log(`- Prompt: ${prompt}`);
    console.log(`- Aspect Ratio: ${aspectRatio}`);
    console.log(`- Size: ${imageSize}`);
    console.log('\nSending request to proxy... (this might take a few seconds)');

    const response = await fetch('http://127.0.0.1:3460/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "gemini-3-pro-image",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        image_config: {
          aspect_ratio: aspectRatio,
          image_size: imageSize
        }
      })
    });

    if (!response.ok) {
      console.error('Request failed:', response.status, await response.text());
      return;
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') continue;

          try {
            const data = JSON.parse(jsonStr);
            if (data.choices?.[0]?.delta?.images?.[0]?.image_url?.url) {
              const url = data.choices[0].delta.images[0].image_url.url;
              if (url.startsWith('data:image/')) {
                const matches = url.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
                if (matches) {
                  const ext = matches[1];
                  const base64Data = matches[2];
                  
                  // Ensure directory exists
                  const outputDir = path.join(process.cwd(), 'generated_images');
                  if (!fs.existsSync(outputDir)){
                      fs.mkdirSync(outputDir);
                  }

                  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                  const filename = `generated-image-${timestamp}.${ext === 'jpeg' ? 'jpg' : ext}`;
                  const fullPath = path.join(outputDir, filename);

                  fs.writeFileSync(fullPath, Buffer.from(base64Data, 'base64'));
                  console.log(`\nSuccess! Image saved.`);
                  console.log(`File path: ${fullPath}`);
                  
                  // Convert path to file URL properly for Windows
                  const fileUrl = `file://${fullPath.split(path.sep).join('/')}`;
                  console.log(`File URL: ${fileUrl}`);
                  return;
                }
              } else {
                console.log(`\nSuccess! Received URL: ${url}`);
                return;
              }
            }
          } catch (e) {
            // ignore parse errors for partial chunks
          }
        }
      }
    }
  } catch (err) {
    console.error('Error:', err);
    console.log('Make sure the proxy server is running on http://127.0.0.1:3460');
    // Ensure rl is closed in case of error
    try { rl.close(); } catch {}
  }
}

generateAndSaveImage();