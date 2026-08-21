export function withUtf8Charset(response: Response): Response {
  let contentType = response.headers.get("Content-Type");
  if (contentType == null || !/^text\//i.test(contentType) || /\bcharset=/i.test(contentType)) {
    return response;
  }

  let normalizedResponse = new Response(response.body, response);
  normalizedResponse.headers.set("Content-Type", `${contentType}; charset=utf-8`);
  return normalizedResponse;
}
