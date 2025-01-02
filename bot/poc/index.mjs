import OpenAI from "openai";
import admin from 'firebase-admin';
import FormData from 'form-data';
import axios from 'axios';

// Configurações da Lambda
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const FIREBASE_SERVICE_ACCOUNT = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organizationId: process.env.OPENAI_ORGANIZATION_ID,
  project: process.env.OPENAI_PROJECT_ID
});

// Inicializar o Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(FIREBASE_SERVICE_ACCOUNT),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}
const database = admin.database();

const getMessages = async () => {
  const messagesRef = database.ref('messages');
  const snapshot = await messagesRef.once('value');
  return Object.values(snapshot.val());
}

const getPosts = async () => {
  const messagesRef = database.ref('posts');
  const snapshot = await messagesRef.once('value');
  return Object.values(snapshot.val());
}

const addResonseMessages = async (message) => {
  const messagesRef = database.ref('messages');
  const timestamp = new Date().getTime();
  const newMessageRef = messagesRef.child(timestamp);
  await newMessageRef.set(message);
}

const addResonsePosts = async (message) => {
  const messagesRef = database.ref('posts');
  const timestamp = new Date().getTime();
  const newMessageRef = messagesRef.child(timestamp);
  await newMessageRef.set(message);
}

const addDalleResonse = async (post, title, message) => {
  const messagesRef = database.ref(`dalle/${post}`);
  const newMessageRef = messagesRef.child(title);
  await newMessageRef.set(message);
}

const getDalleByTitle = async (post, title) => {
  const messagesRef = database.ref(`dalle/${post}`);
  const snapshot = await messagesRef.child(title).once('value');
  return snapshot.val();
}

const newInteraction = async (role, content) => {
  const messagesRef = database.ref('posts');
  const timestamp = new Date().getTime();
  const newMessageRef = messagesRef.child(timestamp);
  const message = { role, content };
  
  await newMessageRef.set(message);

  return message;
}

const print = (message, color) => {
  if (color === 'green')
    color = 32;
  if (color === 'red')
    color = 31;
  if (color === 'blue')
    color = 34;
  if (color === 'yellow')
    color = 33;

  console.log(`\x1b[${color}m${message}\x1b[0m`);
}

const chat = async (messages) => {

  print('Chat: Generating new post...', 'blue');

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: Object.values(messages),
    response_format: {
      "type": "text"
    },
    temperature: 1,
    max_completion_tokens: 2048,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0
  });

  print('Chat: Post generated!', 'green');

  return response.choices[0].message;
}

const dalle = async (prompt) => {
  print('Dalle: Generating image...', 'blue');

  try {
    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt,
      n: 1,
      quality: 'hd',
      response_format: 'url',
      size: '1024x1024',
      style: 'vivid',
    });

    print('Dalle: Image generated!', 'green');

    return response.data[0].url;
  } catch (error) {
    print('Dalle: Error generating image!', 'red');

    console.error('Erro ao gerar imagem com o Dall-e:', error, prompt);
    return null;
  }
}

const postToBlog = async (uri, data, userId) => {
  print('WP: Saving on WP...', 'blue');

  try {
    const response = await fetch(`${process.env.BLOGGER_URI}/${uri}`, {
      method: 'POST',
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(process.env[`BLOGGER_USER_${userId}`])}`
      }
    });

    print('WP: Saved', 'green');

    return response;
  } catch (error) {
    print('WP: Error when saving on WP!', 'red');

    console.error('Error when saving on WP', error, data);
    return null;
  }
}

const getToBlog = async (uri) => {
  const response = await fetch(`${process.env.BLOGGER_URI}/${uri}`, {
    headers: {
      'Authorization': `Basic ${btoa(process.env.BLOGGER_USER_1)}`
    }
  });

  return response;
}

const doSlug = (text) => {
  return text.toLowerCase().trim()
    .replace(/ /g, '-')
    .replace(/[áàâãäå]/g, 'a')
    .replace(/[éèêë]/g, 'e')
    .replace(/[íìîï]/g, 'i')
    .replace(/[óòôõö]/g, 'o')
    .replace(/[úùûü]/g, 'u')
    .replace(/[ç]/g, 'c')
    .replace(/[^a-z0-9-]/g, '');
}

const createTags = async (tags, userId) => {
  print('WP: Creating tags...', 'blue');

  try {
    const tagIds = [];
    for (const tag of tags) {
      const response = await postToBlog('tags', { name: tag, slug: doSlug(tag) }, userId);
      const body = await response.json();

      if (response.status === 201) {
        tagIds.push(body.id);
      }
      if (response.status === 400) {
        tagIds.push(body.data.term_id);
      }
    }

    print('WP: Tags created!', 'green');

    return tagIds;
  } catch (error) {
    print('WP: Error creating tags!', 'red');

    console.error('Erro ao criar as tags no blog:', error);
    return [];
  }
}

const checkPostExists = async (slug) => {
  print('WP: Checking if post exists...', 'blue');
  const postExists = await getToBlog(`posts?slug=${slug}`);
  const postExistsBody = await postExists.json();
  if (postExistsBody.length > 0) {
    print('WP: Post already exists!', 'red');
    return true;
  }

  return false;
}

const createPost = async (postContent) => {
  print('WP: Creating post...', 'blue');
  
  await postToBlog('posts', postContent, postContent.author);

  print('WP: Post created!', 'green');
}

const createMedia = async (url, title, userId) => {
  print('WP: Creating media...', 'blue');

  try {
    const form = new FormData();

    // Fetch the image from the URL
    const response = await axios.get(url, { responseType: 'stream' });
    form.append('file', response.data, { filename: `${doSlug(title)}.png` });
    form.append('title', title);
    form.append('userId', userId);

    // Make sure to handle the form submission appropriately
    const result = await axios.post(`${process.env.BLOGGER_URI}/media`, form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Basic ${btoa(process.env[`BLOGGER_USER_${userId}`])}`,
      },
    });

    print('WP: Media created!', 'green');

    return result.data;
  } catch (error) {
    print('WP: Error creating media!', 'red');

    console.error('Erro ao criar a imagem no blog:', error);
    return null;
  }
}

const traitJson = (responseSugestion) => {
  const jsonStartIndex = responseSugestion.indexOf('```json') + 7;
  if (jsonStartIndex === -1) {
    return null;
  }

  const jsonEndIndex = responseSugestion.lastIndexOf('```', responseSugestion.lastIndexOf('```', responseSugestion.lastIndexOf('```') - 1) - 1);
  const jsonString = responseSugestion.substring(jsonStartIndex, jsonEndIndex).trim();
  return JSON.parse(jsonString);
}

const traitDalle = (responseSugestion) => {
  const dalleStartIndex = responseSugestion.indexOf('```shell') + 8;
  if (dalleStartIndex === -1) {
    return null;
  }

  const dalleEndIndex = responseSugestion.lastIndexOf('```');
  const dalleString = responseSugestion.substring(dalleStartIndex, dalleEndIndex).trim();
  return JSON.parse(dalleString.replace(/\n/g, ""));
}

const replaceImage = (content, title, image) => {
  return content
    .replace(`<img title="${title}" />`, image)
    .replace(`<img title='${title}' />`, image);
}

export const handler = async (event) => {
  try {
    print(`Starting post for category ${event.categoryId}...`, 'yellow');

    const messages = await getMessages();

    messages.push(await newInteraction('user', `Gere um post para a categoria ${event.categoryId}, não esqueça de colocar o post no JSON informado antes, para cada frase gere um texto de 500 caracteres ou mais. Também gere um promt de comando para o Dall-e, gerar uma imagem de capa e uma imagem para cada tópico do post, no máximo 5 imagens, coloque todos os prompts no mesmo JSON, use o seguinte json, \`[{title: "Titulo da imagem", prompt: "Comando para o dall-e gerar a imagem"}, ...]\`, mas adicione esse JSON em um bloco shell. Adicione essa tag <img title="" /> em cada tópico e adicione o titulo do tópico no atributo title da tag.`));

    const responseSugestion = await chat(messages);
    if (!responseSugestion || !responseSugestion.content) {
      throw new Error('Erro ao buscar sugestão de resposta.');
    }

    addResonsePosts(responseSugestion);
    
    // Comentado, pois é para gerar uma post de teste sem passar pelo chat
    // const posts = await getPosts();
    // const responseSugestion = posts[posts.length - 1]

    const postContent = await traitJson(responseSugestion.content);
    if (!postContent) {
      throw new Error('Erro ao processar o json na resposta do OpenAI.');
    }

    const postExists = await checkPostExists(doSlug(postContent.title));
    if (postExists) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Post já existe.' }),
      };
    }

    const dallePromptsArray = await traitDalle(responseSugestion.content);
    if (!dallePromptsArray) {
      throw new Error('Erro ao processar o prompt do Dall-e na resposta do OpenAI.');
    }

    console.log(postContent.content)
    process.exit(0);

    const mediaIds = [];
    for (const dallePrompt of dallePromptsArray) {
      const index = dallePromptsArray.indexOf(dallePrompt);
      if (index >= 6) {
        postContent.content = replaceImage(postContent.content, dallePrompt.title, "");

        continue;
      }

      const dalleResponse = await dalle(dallePrompt.prompt);

      await addDalleResonse(postContent.title, dallePrompt.title, {title: dallePrompt.title, url: dalleResponse});

      // Comentado, pois é para gerar uma imagem de teste sem passar pelo Dall-e
      // const { url: dalleResponse } = await getDalleByTitle(postContent.title, dallePrompt.title);

      const mediaResponse = await createMedia(dalleResponse, `${postContent.title} - ${dallePrompt.title}`, 2);
      const mediaRendered = mediaResponse.description.rendered.replace('class="attachment-medium size-medium"', 'class="attachment-medium size-medium aligncenter"')

      mediaIds.push(mediaResponse.id);
      postContent.content = replaceImage(postContent.content, dallePrompt.title, mediaRendered);

      if (dallePrompt.title.indexOf('Capa') !== -1) {
        postContent.featured_media = mediaResponse.id;
      }
    }

    if (!postContent.featured_media) {
      postContent.featured_media = mediaIds[randomInt(0, mediaIds.length - 1)];
    }

    const date = new Date();
    postContent.date = date.toISOString();
    postContent.date_gmt = new Date(new Date().getTime() + 3 * 60 * 60 * 1000).toISOString();
    delete postContent.template;

    const tags = await createTags(postContent.tags, postContent.author);
    postContent.tags = tags;

    await createPost(postContent);

    print(`Post for category ${event.categoryId} created!`, 'yellow');

    return {
      statusCode: 200,
      body: JSON.stringify(messages),
    };
  } catch (error) {
    console.error('Erro:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erro ao buscar mensagens.' }),
    };
  }
};
