"""Optional gateway to the content team's existing script API.

Only an operator-configured upstream is used. The browser supplies no target
URL, and private credentials/errors are never forwarded back to the browser.
PDF ingestion stays in the browser; this gateway does not convert PowerPoint.
"""

import json

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

from .settings import Settings

MAX_JSON_BYTES = 1024 * 1024


def content_routes(settings: Settings) -> APIRouter:
    router = APIRouter()

    async def forward(request: Request, path: str):
        if not settings.content_url:
            raise HTTPException(503, "The script service has not been connected on this server")
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_JSON_BYTES:
                raise HTTPException(413, "Script request exceeds 1 MB")
        try:
            payload = json.loads(body)
        except (ValueError, UnicodeError) as e:
            raise HTTPException(400, "Expected a JSON request") from e
        headers = {"Content-Type": "application/json"}
        if key := settings.content_api_key.get_secret_value():
            headers["Authorization"] = f"Bearer {key}"
        try:
            async with httpx.AsyncClient(timeout=18, follow_redirects=False) as client:
                async with client.stream(
                    "POST", settings.content_url + path, json=payload, headers=headers
                ) as result:
                    if not result.is_success:
                        raise HTTPException(
                            502, "The script service could not complete this request"
                        )
                    if result.status_code == 204:
                        return Response(status_code=204)
                    output = bytearray()
                    async for chunk in result.aiter_bytes():
                        output.extend(chunk)
                        if len(output) > MAX_JSON_BYTES:
                            raise HTTPException(502, "The script service returned too much data")
                    return json.loads(output)
        except (httpx.HTTPError, ValueError, UnicodeError) as e:
            raise HTTPException(
                502, "The script service is unavailable or returned invalid JSON"
            ) from e

    @router.post("/scripts")
    async def scripts(request: Request):
        return await forward(request, "scripts")

    @router.post("/feedback/wrong-fact")
    async def feedback(request: Request):
        return await forward(request, "feedback/wrong-fact")

    # Prewarming is optional in the content contract. Accepting it does not
    # imply inference; the UI's following /scripts request does the actual work.
    @router.post("/decks/{deck_id}/prewarm", status_code=204)
    async def prewarm(deck_id: str):
        return Response(status_code=204)

    return router
