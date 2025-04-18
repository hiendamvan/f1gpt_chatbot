
import OpenAI from "openai";
import { DataAPIClient } from "@datastax/astra-db-ts";
import { pipeline } from "@xenova/transformers";
import { Console } from "console";// Import OpenRouter SDK
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText } from 'ai';
import { z } from 'zod';
//export const runtime = "edge";

const {
    ASTRA_DB_NAMESPACE,
    ASTRA_DB_COLLECTION,
    ASTRA_DB_API_ENDPOINT,
    ASTRA_DB_APPLICATION_TOKEN,
    OPEN_ROUTER_API_KEY
  } = process.env;

  
const openrouter = createOpenRouter({
    apiKey: OPEN_ROUTER_API_KEY,
});

const client = new DataAPIClient( ASTRA_DB_APPLICATION_TOKEN);
const db = client.db(ASTRA_DB_API_ENDPOINT, {keyspace: ASTRA_DB_NAMESPACE});

let generateEmbedding: any;

async function getEmbeddingPipeline() {
  if (!generateEmbedding) {
    generateEmbedding = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return generateEmbedding;
}

export async function POST(req: Request) {
    try {
        const { messages} = await req.json();
        const latestMessage = messages[messages?.length - 1]?.content;

        let docContext = ""
        
        // embedding 
        const pipe = await getEmbeddingPipeline();
        const output = await pipe(latestMessage, {
            pooling: "mean",
            normalize: true,
        });

        const vector: number[] = Array.from(output.data); // Convert from TypedArray to number[]

        // find similar in db
        try {
            const collection = await db.collection(ASTRA_DB_COLLECTION);

            const cursor = collection.find(null, {
                sort : {
                    $vector: vector,
                }, 
                limit: 5
            })
            const documents = await cursor.toArray()
            const docsMap = documents?.map((doc) => doc.text)
            docContext = JSON.stringify(docsMap)

            const template = {
                role: "system",
                content: `You are an AI assistant who know everything about volleyball. 
                Use the context given below to augment what you know about volleyball. 
                The context will give you the most recent information about volleyball from wikipedia.
                If the context doesn't include the information, you need to answer based on your 
                existing knowledge and don't mention the source of the information or what the 
                context does or does not include. 
                Format answer using markdown where applicable and don't return images. 
            -------------
            START CONTEXT
            ${docContext}
            END CONTEXT
            -------------
            QUESTION: ${latestMessage}
            -------------
            `
            }
            
            const response = streamText({
                model: openrouter('gpt-4o-mini'),
                messages: [template, ...messages],
                temperature: 0.7,
                maxTokens: 512,
            });
            console.log("Response: ", response)
            return response.toDataStreamResponse();


        }  catch (error) {
            console.log("Error in querying db ...")
            return new Response("Internal server error", { status: 500 });

        }
    } catch (error) {
        return new Response("Internal server error", { status: 500 });
    }
}
