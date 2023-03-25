import express from 'express';
import axios from 'axios';
import dedent from 'dedent-js';
import * as dotenv from 'dotenv';
import {Configuration, OpenAIApi} from 'openai';

// Get .env settings
dotenv.config();

// Initialize OpenAI API
const configuration = new Configuration({organization: 'org-zdTlhY1Yc8EXzKH8GRYz8XJP', apiKey: process.env.openAIKey});
const openai = new OpenAIApi(configuration);

// Initialize Express server
const app = express();
app.use(express.json());

app.post('/fillSummary/:cardId', authenticate, async (req, res) => {
    const cardId = req.params.cardId;
    try {

        const card = await getCardById(cardId);
        const comments = await getCardComments(cardId);

        let formattedComments = '';
        for (const comment of comments) {
            const creator = await getMember(comment.idMemberCreator);
            formattedComments += `[${comment.date}] ${creator.fullName}: ${comment?.data?.text?.replace('\n', ' ')}\n`;
        }

        const prompt = dedent(`
        Summarize the issue in this Trello card as a less than a 20-word meeting writeup without new lines.
        Comments start with the time in '[]', then the name of the user and the message after ':'
        You will now get the title, description and each comment on the card.
        --- 
        Title: ${card.name}
        ---
        Description: ${card.desc}
        ---
        Comments: ${formattedComments}
        `);

        const completion = await openai.createCompletion({
            model: 'text-davinci-003',
            prompt: prompt,
            temperature: 0.6,
            max_tokens: 2048
        });

        let text = completion.data.choices[0].text || '';
        text = text.replaceAll('\n', ' ').trim();

        const response = await updateCustomField(cardId, text);

        res.status(200).json({result: text});
    } catch (e) {
        res.status(500).json({result: e.message || e});
    }
});

app.listen(process.env.port || 12345, () => {
    console.log('Butler server listening...');
});

async function getCardById(cardId) {
    const resp = await axios.get(formatEndpoint(`/cards/${cardId}`));
    if (resp.status !== 200) throw new Error(`Trello API returned code ${resp.status}: ${resp.message}`);
    return resp.data;
}

async function getCardComments(cardId) {
    const resp = await axios.get(`${formatEndpoint(`/cards/${cardId}/actions`)}&filter=commentCard`);
    if (resp.status !== 200) throw new Error(`Trello API returned code ${resp.status}: ${resp.message}`);
    return resp.data;
}

async function getMember(id) {
    const resp = await axios.get(formatEndpoint(`/members/${id}`));
    if (resp.status !== 200) throw new Error(`Trello API returned code ${resp.status}: ${resp.message}`);
    return resp.data;
}

async function updateCustomField(id, content) {
    const resp = await axios.put(formatEndpoint(`/cards/${id}/customField/${process.env.trelloFieldId}/item`), {'value': {'text': content}});
    if (resp.status !== 200) throw new Error(`Trello API returned code ${resp.status}: ${resp.message}`);
    return resp.data;
}

function formatEndpoint(link) {
    return `https://api.trello.com/1/${link}?key=${process.env.trelloKey}&token=${process.env.trelloToken}`;
}

function authenticate(req, res, next) {
    const token = req.headers.authorization;
    if (token === process.env.authToken) {
        return next();
    } else {
        return res.status(401).json({error: 'Invalid token'});
    }
}
