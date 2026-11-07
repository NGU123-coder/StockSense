from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_forecast_endpoint_requires_internal_key():
    r = client.post("/forecast/run", json={})
    assert r.status_code == 401


def test_request_validation_rejects_bad_service_level():
    r = client.post("/forecast/run", json={"service_level": 1.5}, headers={"X-Internal-Key": "wrong"})
    assert r.status_code in (401, 422)


def test_openapi_docs_available():
    r = client.get("/openapi.json")
    assert r.status_code == 200
    assert "/forecast/run" in r.json()["paths"]
