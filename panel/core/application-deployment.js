import {assert, HttpError} from '../common.js';

const id = (value) =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));
export function validateDeployment(definition, profiles) {
  const deployment = definition.deployment;
  if (!deployment) return;
  assert(
    exact(deployment, ['version', 'permission', 'requiresStopped', 'steps']) &&
      deployment.version === 1 &&
      deployment.requiresStopped === true &&
      deployment.permission === 'application.' + definition.id + '.deploy',
    'Invalid application deployment policy.',
  );
  assert(
    Array.isArray(deployment.steps) &&
      deployment.steps.length > 0 &&
      deployment.steps.length <= 16 &&
      new Set(deployment.steps.map((step) => step.id)).size ===
        deployment.steps.length,
    'Deployment needs a bounded ordered step list.',
  );
  for (const step of deployment.steps) {
    const service = definition.services.find(
        (service) => service.id === step.service,
      ),
      task = service && profiles[service.profile]?.deploymentTasks?.[step.task];
    assert(
      exact(step, ['id', 'label', 'service', 'task', 'replay']) &&
        id(step.id) &&
        typeof step.label === 'string' &&
        step.label.length > 0 &&
        step.label.length <= 100 &&
        !/[\x00\r\n]/.test(step.label) &&
        id(step.task) &&
        step.replay === 'manual' &&
        task &&
        typeof task.run === 'function' &&
        typeof task.inspect === 'function',
      'Deployment steps require reviewed tasks and postcondition inspectors.',
    );
  }
}
export class ApplicationDeployment {
  constructor(
    definition,
    profiles,
    {ctx, runtime, configuration, privateSecrets},
  ) {
    validateDeployment(definition, profiles);
    Object.assign(this, {
      definition,
      profiles,
      ctx,
      runtime,
      configuration,
      privateSecrets,
    });
  }
  context(step, values) {
    const service = this.definition.services.find(
      (service) => service.id === step.service,
    );
    return {
      ctx: this.ctx,
      service,
      step,
      configuration: values,
      secrets: this.privateSecrets(service),
    };
  }
  task(step) {
    const service = this.definition.services.find(
      (service) => service.id === step.service,
    );
    return this.profiles[service.profile].deploymentTasks[step.task];
  }
  async inspect(step, values) {
    try {
      const state = await this.task(step).inspect(this.context(step, values));
      assert(
        ['complete', 'absent', 'unknown'].includes(state),
        'Invalid deployment observation.',
      );
      return state;
    } catch {
      return 'unknown';
    }
  }
  async observations() {
    const values = await this.configuration();
    return Promise.all(
      this.definition.deployment.steps.map(async (step) => ({
        id: step.id,
        label: step.label,
        service: step.service,
        state: await this.inspect(step, values),
      })),
    );
  }
  async requireReady() {
    assert(
      (await this.observations()).every((step) => step.state === 'complete'),
      'Review and deploy the application before starting its services.',
      409,
    );
  }
  async run(params, job) {
    assert(
      params?.confirm === true &&
        Object.keys(params).every((key) => key === 'confirm'),
      'Confirm the declared deployment. Commands or task overrides are not accepted.',
    );
    assert(
      (await this.runtime.status()).running === false,
      'Stop all application services before deploying.',
      409,
    );
    const values = await this.configuration(),
      steps = this.definition.deployment.steps.map((step) => ({
        id: step.id,
        service: step.service,
        state: 'pending',
      }));
    for (const [index, step] of this.definition.deployment.steps.entries()) {
      assert(
        (await this.runtime.status()).running === false,
        'An application service became active during deployment. Review before continuing.',
        409,
      );
      const observed = await this.inspect(step, values);
      assert(
        observed !== 'unknown',
        'A deployment postcondition is unknown. Inspect the application before submitting work.',
        409,
      );
      if (observed === 'complete') {
        steps[index].state = 'verified';
        continue;
      }
      steps[index].state = 'submitted';
      await this.ctx.stageMessage(job, step.label + '…', 'deployment-step', {
        deployment: {
          revision: this.definition.revision,
          steps: structuredClone(steps),
        },
      });
      let failed = false;
      try {
        await this.task(step).run(this.context(step, values));
      } catch {
        failed = true;
      }
      const after = await this.inspect(step, values);
      if (after === 'complete') steps[index].state = 'verified';
      else if (after === 'absent' && failed) {
        steps[index].state = 'not-applied';
        await this.ctx.stageMessage(
          job,
          step.label + ' did not apply.',
          'deployment-step',
          {
            deployment: {
              revision: this.definition.revision,
              steps: structuredClone(steps),
            },
          },
        );
        throw new HttpError(
          409,
          'Deployment stopped before this step applied. Review the application before trying again.',
        );
      } else
        throw new HttpError(
          409,
          'The deployment step outcome is unconfirmed. Inspect it before any retry.',
        );
      await this.ctx.stageMessage(
        job,
        step.label + ' verified.',
        'deployment-step',
        {
          deployment: {
            revision: this.definition.revision,
            steps: structuredClone(steps),
          },
        },
      );
    }
    return {
      message:
        'Application deployment verified. Start its services when ready.',
    };
  }
  after(job) {
    if (
      job.target?.deployment?.steps.some((step) => step.state === 'submitted')
    )
      throw Error(
        'A deployment step outcome is unconfirmed. No task was replayed or rolled back.',
      );
  }
  async recover() {
    return (await this.observations()).every(
      (step) => step.state === 'complete',
    )
      ? {
          outcome: 'succeeded',
          message: 'Every declared deployment postcondition is verified.',
        }
      : {
          message:
            'Inspect the deployment steps and external dependencies. No task was replayed and no database migration was rolled back.',
        };
  }
}
