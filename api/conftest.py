import os
import pytest


@pytest.fixture(autouse=True)
def fake_client_id(monkeypatch):
    """所有测试默认有合法 client_id；个别测试可 monkeypatch 取消。"""
    monkeypatch.setenv("JAMENDO_CLIENT_ID", "test_client_id")
