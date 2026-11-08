import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { updateNotice } from "./update-check.js";

type TextContent = { type: "text"; text: string };

/**
 * Add the update notice, when there is one, as its own text block after the
 * tool's answer, so the answer itself (often JSON) stays unchanged.
 */
export function withNotice(content: TextContent[], notice: string | null): TextContent[] {
  return notice ? [...content, { type: "text", text: notice }] : content;
}

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
    const notice = updateNotice();
    try {
      const text = await handler(args);
      return { content: withNotice([{ type: "text", text }], notice) };
    } catch (error) {
      return {
        content: withNotice([{ type: "text", text: `Error: ${(error as Error).message}` }], notice),
        isError: true,
      };
    }
  });
}
