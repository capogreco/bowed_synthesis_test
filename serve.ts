// serve.ts
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { serveDir } from "https://deno.land/std@0.208.0/http/file_server.ts";

console.log("Deno HTTP server running. Access at: http://localhost:8000/");

serve(async (req) => {
    // Construct the path to the requested file within the 'app' directory.
    // The serveDir function expects paths relative to its fsRoot.
    return serveDir(req, {
        fsRoot: "app", // Serve files from the 'app' directory
        urlRoot: "",   // Serve 'app' directory content directly at the root (e.g., /index.html)
        showDirListing: true, // Optional: for debugging, allows viewing directory contents
        enableCors: true,     // Optional: enable CORS if you plan to fetch resources from different origins
    });
}, { port: 8000 });