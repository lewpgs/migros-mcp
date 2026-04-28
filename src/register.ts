import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";

/**
 * Register an MCP tool with uniform error handling. Saves the boilerplate
 * try/catch wrapper that every tool would otherwise duplicate.
 *
 * The handler returns a plain string (typically formatted JSON); this wraps
 * it in the SDK's content/text envelope and surfaces thrown errors as
 * `isError` responses so the LLM sees a useful message instead of a hang.
 */
export function register(
  server: McpServer,
  name: string,
  description: string,
  shape: ZodRawShape,
  handler: (args: any) => Promise<string>
): void {
  server.tool(name, description, shape, async (args: unknown) => {
    try {
      const text = await handler(args);
      return { content: [{ type: "text", text }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  });
}
