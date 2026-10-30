const element = (tag, text) => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};
let host, notice, list, signature;
let refreshGeneration = 0;
async function command(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GhostAPI-Client': 'dashboard' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
export function initDeliveryWorkflows(parent) {
  host = element('details', '');
  host.className = 'panel research-request';
  host.append(element('summary', 'Reviewed delivery APIs'));
  notice = element(
    'p',
    'Create a draft from a completed delivery result, review it, then publish a local endpoint.',
  );
  notice.setAttribute('role', 'status');
  list = element('div', '');
  host.append(notice, list);
  parent.append(host);
  setInterval(() => void refresh(), 5000);
  void refresh();
}
export function workflowDraftButton(job) {
  const button = element('button', 'Review as API');
  button.className = 'button secondary';
  button.onclick = async () => {
    button.disabled = true;
    try {
      await command('/api/delivery-workflows', { job_id: job.id });
      host.open = true;
      await refresh();
      host.scrollIntoView({ behavior: 'smooth' });
      notice.textContent =
        'Draft created from the supported delivery engine and this observed check. Review before publishing.';
    } catch (error) {
      notice.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  return button;
}
async function refresh() {
  if (!host || document.hidden) return;
  const generation = ++refreshGeneration;
  try {
    const response = await fetch('/api/delivery-workflows');
    if (!response.ok) return;
    const data = await response.json();
    const jobsResponse = await fetch('/api/delivery-jobs');
    const jobs = jobsResponse.ok ? (await jobsResponse.json()).jobs : [];
    if (generation !== refreshGeneration) return;
    const next = JSON.stringify({
      data,
      jobs: jobs.map((job) => ({ id: job.id, status: job.status })),
    });
    if (next === signature) return;
    signature = next;
    const focused = document.activeElement;
    const focusId = list.contains(focused) ? focused.id : undefined;
    const cursor =
      focusId && focused instanceof HTMLInputElement
        ? { start: focused.selectionStart, end: focused.selectionEnd }
        : undefined;
    const edits = new Map(
      [...list.children].map((card) => [
        card.dataset.workflowId,
        {
          digest: card.dataset.digest,
          reviewKey: card.dataset.reviewKey,
          pin: card.querySelector('form input')?.value,
          variant: card.querySelector('input[aria-label="Variant for this API"]')?.value,
          reviewed: card.querySelector('input[type="checkbox"]')?.checked,
          open: card.querySelector('details')?.open,
          source: card.querySelector('select')?.value,
        },
      ]),
    );
    list.replaceChildren();
    for (const item of data.workflows) {
      const saved = edits.get(item.id);
      const reviewKey = `${item.digest}:${(item.validation_job_ids ?? []).join(',')}`;
      const card = element('article', '');
      card.dataset.workflowId = item.id;
      card.dataset.digest = item.digest;
      card.dataset.reviewKey = reviewKey;
      card.className = 'panel research-request';
      card.append(
        element('h3', `Delivery API · version ${item.version} · ${item.status}`),
        element('p', item.spec.url),
        element('p', `Baseline run: ${item.source_run_id}`),
        element(
          'p',
          `Health: ${(item.health ?? 'not_checked').replaceAll('_', ' ')}${item.health === 'suspected_drift' ? ' · Repeated evidence gaps may indicate drift; review the source before replacing anything.' : ''}`,
        ),
      );
      const details = element('details', '');
      details.open = saved?.open ?? false;
      details.append(element('summary', 'Contract, permitted actions and evidence requirements'));
      const spec = element('pre', JSON.stringify(item.spec, null, 2));
      spec.style.whiteSpace = 'pre-wrap';
      spec.style.overflowWrap = 'anywhere';
      details.append(spec, element('p', `Digest: ${item.digest}`));
      card.append(details);
      if (item.status === 'draft') {
        if (item.replaces_id) {
          card.append(
            element(
              'p',
              'Replacement draft. Validation runs up to three fresh checks using known inputs and shared limits. Review the resulting evidence before publication.',
            ),
          );
          const validate = element('button', 'Validate replacement');
          validate.className = 'button secondary';
          validate.onclick = async () => {
            validate.disabled = true;
            notice.textContent =
              'Validating replacement. Fresh jobs appear in delivery checks; do not start duplicate checks.';
            try {
              await command(`/api/delivery-workflows/${item.id}/validate`, {});
              await refresh();
              notice.textContent =
                'Validation finished. Review every validation result before publishing.';
            } catch (error) {
              notice.textContent = error.message;
            } finally {
              validate.disabled = false;
            }
          };
          card.append(validate);
          for (const id of item.validation_job_ids ?? []) {
            const job = jobs.find((job) => job.id === id);
            card.append(
              element(
                'p',
                `Validation ${id}: ${job?.status ?? 'missing'} · ${job?.result?.verdict ?? 'No confirmed result'}`,
              ),
            );
          }
        }
        const label = element('label', '');
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.id = `workflow-review-${item.id}`;
        check.checked = saved?.reviewKey === reviewKey && saved.reviewed === true;
        label.append(
          check,
          document.createTextNode(
            ' I reviewed this URL, actions, evidence requirements and limitations.',
          ),
        );
        const publish = element('button', 'Publish local API');
        publish.className = 'button primary';
        publish.disabled = !check.checked;
        check.onchange = () => (publish.disabled = !check.checked);
        publish.onclick = async () => {
          publish.disabled = true;
          try {
            await command(`/api/delivery-workflows/${item.id}/publish`, { digest: item.digest });
            await refresh();
            notice.textContent = 'Local API published.';
          } catch (error) {
            notice.textContent = error.message;
            publish.disabled = !check.checked;
          }
        };
        card.append(label, publish);
      }
      if (item.status === 'published') {
        const path = `/api/delivery-workflows/${item.id}/invoke`;
        const code = element(
          'pre',
          `POST ${path}\nContent-Type: application/json\nX-GhostAPI-Client: dashboard\n\n${JSON.stringify({ pincode: '560064' })}\n\nUses your signed-in session. Poll the returned status_url.`,
        );
        code.style.whiteSpace = 'pre-wrap';
        code.style.overflowWrap = 'anywhere';
        card.append(code);
        const docs = element('a', 'Open API specification ↗');
        docs.href = `/api/delivery-workflows/${item.id}/openapi`;
        docs.target = '_blank';
        docs.rel = 'noopener noreferrer';
        card.append(docs);
        const form = element('form', '');
        form.className = 'website-form';
        const pin = document.createElement('input');
        pin.required = true;
        pin.pattern = '[1-9][0-9]{5}';
        pin.maxLength = 6;
        pin.inputMode = 'numeric';
        pin.id = `workflow-pin-${item.id}`;
        if (saved?.digest === item.digest) pin.value = saved.pin ?? '';
        const label = element('label', 'Delivery PIN for this API');
        label.htmlFor = pin.id;
        const variant = document.createElement('input');
        variant.maxLength = 200;
        variant.placeholder = 'Variant (optional)';
        variant.setAttribute('aria-label', 'Variant for this API');
        variant.id = `workflow-variant-${item.id}`;
        if (saved?.digest === item.digest) variant.value = saved.variant ?? '';
        const run = element('button', 'Invoke fresh check');
        run.className = 'button secondary';
        form.append(label, pin, variant, run);
        form.onsubmit = async (event) => {
          event.preventDefault();
          run.disabled = true;
          try {
            const result = await command(path, {
              pincode: pin.value,
              ...(variant.value.trim() ? { variant: variant.value.trim() } : {}),
            });
            notice.textContent = `Fresh job started: ${result.job_id}. Results appear in delivery checks above.`;
          } catch (error) {
            notice.textContent = error.message;
          } finally {
            run.disabled = false;
          }
        };
        card.append(form);
        const newer = jobs.filter(
          (job) =>
            job.input.url === item.spec.url &&
            job.id !== item.source_job_id &&
            job.status === 'completed' &&
            job.result?.verdict !== 'UNKNOWN' &&
            Date.parse(job.result?.checked_at ?? '') >= Date.parse(item.created_at),
        );
        const replacementLabel = element('label', 'Confirmed observation for replacement');
        const select = document.createElement('select');
        select.id = `replacement-source-${item.id}`;
        replacementLabel.htmlFor = select.id;
        for (const job of newer) {
          const option = element(
            'option',
            `${job.input.pincode} · ${job.result.verdict} · ${new Date(job.result.checked_at).toLocaleString()}`,
          );
          option.value = job.id;
          select.append(option);
        }
        if ([...select.options].some((option) => option.value === saved?.source))
          select.value = saved.source;
        const prepare = element('button', 'Prepare replacement draft');
        prepare.className = 'button secondary';
        prepare.disabled = !newer.length;
        prepare.onclick = async () => {
          prepare.disabled = true;
          try {
            await command('/api/delivery-workflows', {
              job_id: select.value,
              replaces_id: item.id,
            });
            await refresh();
            notice.textContent =
              'Replacement draft prepared. The current version remains published until validation and approval.';
          } catch (error) {
            notice.textContent = error.message;
            prepare.disabled = false;
          }
        };
        card.append(replacementLabel, select, prepare);
      }
      if (item.status !== 'retired') {
        const retire = element('button', 'Retire API');
        retire.className = 'button secondary';
        retire.onclick = async () => {
          try {
            await command(`/api/delivery-workflows/${item.id}/retire`, {});
            await refresh();
            notice.textContent = 'Workflow retired. Existing observations remain available.';
          } catch (error) {
            notice.textContent = error.message;
          }
        };
        card.append(retire);
      }
      list.append(card);
    }
    if (focusId) {
      const replacement = document.getElementById(focusId);
      replacement?.focus({ preventScroll: true });
      if (
        replacement instanceof HTMLInputElement &&
        typeof cursor?.start === 'number' &&
        typeof cursor.end === 'number'
      )
        replacement.setSelectionRange(cursor.start, cursor.end);
    }
  } catch {
    notice.textContent = 'Unable to refresh workflow contracts.';
  }
}
