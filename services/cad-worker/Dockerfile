# Gestaltung CAD worker: FastAPI + CadQuery on Cloud Run.
# Stages: base (deps + app) -> test (runs pytest, incl. the cadquery tests) -> runtime.
# runtime copies a marker file from test, so the image cannot be built unless the tests pass.

FROM python:3.12-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1
# Shared libraries the OpenCascade (OCP) and VTK wheels load at import time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libgl1 libglu1-mesa libegl1 libglib2.0-0 libgomp1 \
      libx11-6 libxext6 libxrender1 libxcursor1 libxft2 libxinerama1 libxi6 libxrandr2 libsm6 libice6 \
      libfontconfig1 libfreetype6 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt \
 && pip freeze > /srv/pip-freeze.txt \
 && cat /srv/pip-freeze.txt
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin cad
COPY app ./app

FROM base AS test
COPY requirements-dev.txt pytest.ini ./
COPY tests ./tests
RUN pip install -r requirements-dev.txt
USER cad
RUN python -c "import cadquery; print('cadquery', cadquery.__version__)" \
 && python -m pytest -p no:cacheprovider -v \
 && touch /tmp/TESTS_PASSED

FROM base AS runtime
COPY --from=test /tmp/TESTS_PASSED /srv/TESTS_PASSED
USER cad
ENV PORT=8080
EXPOSE 8080
# One uvicorn worker: each build already runs in its own child process.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers"]
