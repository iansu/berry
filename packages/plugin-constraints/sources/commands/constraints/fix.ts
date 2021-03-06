import {Cache, Configuration, Descriptor, Project, PluginConfiguration} from '@berry/core';
import {MessageName, StreamReport}                                      from '@berry/core';
import {structUtils}                                                    from '@berry/core';
import inquirer                                                         from 'inquirer';
import {Readable, Writable}                                             from 'stream';

import {Constraints}                                                    from '../../Constraints';

// eslint-disable-next-line arca/no-default-export
export default (clipanion: any, pluginConfiguration: PluginConfiguration) => clipanion

  .command(`constraints fix`)

  .categorize(`Constraints-related commands`)
  .describe(`make the project constraint-compliant if possible`)

  .detail(`
    This command will run constraints on your project and try its best to automatically fix any error it finds. If some errors cannot be automatically fixed (in particular all errors triggered by \`gen_invalid_dependency\` rules) the process will exit with a non-zero exit code, and an install will be automatically be ran otherwise.

    For more information as to how to write constraints, please consult our dedicated page on our website: .
  `)

  .example(
    `Automatically fix as many things as possible in your project`,
    `yarn constraints fix`,
  )

  .action(async ({cwd, stdin, stdout}: {cwd: string, stdin: Readable, stdout: Writable}) => {
    const configuration = await Configuration.find(cwd, pluginConfiguration);
    const {project} = await Project.find(configuration, cwd);
    const cache = await Cache.find(configuration);
    const constraints = await Constraints.find(project);

    const result = await constraints.process();

    // @ts-ignore
    const prompt = inquirer.createPromptModule({
      input: stdin,
      output: stdout,
    });

    let modified = false;

    for (const {workspace, dependencyIdent, dependencyRange, dependencyType} of result.enforcedDependencyRanges) {
      if (dependencyRange !== null) {
        const invalidDependencies = Array.from(workspace.manifest[dependencyType].values()).filter((dependency: Descriptor) => {
          return structUtils.areIdentsEqual(dependency, dependencyIdent) && dependency.range !== dependencyRange;
        });

        for (const invalid of invalidDependencies) {
          const result = await prompt({
            type: `confirm`,
            name: `confirmed`,
            message: `${structUtils.prettyLocator(configuration, workspace.locator)}: Change ${structUtils.prettyIdent(configuration, invalid)} in ${dependencyType} into ${structUtils.prettyRange(configuration, dependencyRange)}?`,
          });

          // @ts-ignore
          if (result.confirmed) {
            const newDescriptor = structUtils.makeDescriptor(invalid, dependencyRange);

            workspace.manifest[dependencyType].delete(invalid.identHash);
            workspace.manifest[dependencyType].set(newDescriptor.identHash, newDescriptor);

            modified = true;
          }
        }
      } else {
        const invalidDependencies = Array.from(workspace.manifest[dependencyType].values()).filter((dependency: Descriptor) => {
          return structUtils.areIdentsEqual(dependency, dependencyIdent);
        });

        for (const invalid of invalidDependencies) {
          const result = await prompt({
            type: `confirm`,
            name: `confirmed`,
            message: `${structUtils.prettyLocator(configuration, workspace.locator)}: Remove ${structUtils.prettyDescriptor(configuration, invalid)} from the ${dependencyType}?`,
          });

          // @ts-ignore
          if (result.confirmed) {
            workspace.manifest[dependencyType].delete(invalid.identHash);

            modified = true;
          }
        }
      }

      await workspace.persistManifest();
    }

    if (result.invalidDependencies) {
      if (modified)
        stdout.write(`\n`);

      const report = await StreamReport.start({configuration, stdout}, async (report: StreamReport) => {
        for (const {workspace, dependencyIdent, dependencyType, reason} of result.invalidDependencies) {
          const dependencyDescriptor = workspace.manifest[dependencyType].get(dependencyIdent.identHash);
  
          if (dependencyDescriptor) {
            report.reportError(MessageName.CONSTRAINTS_INVALID_DEPENDENCY, `${structUtils.prettyWorkspace(configuration, workspace)} has an unfixable invalid dependency on ${structUtils.prettyIdent(configuration, dependencyIdent)} in ${dependencyType} (invalid because ${reason})`);
          }
        }
      });

      return report.exitCode();
    }

    if (modified) {
      stdout.write(`\n`);

      const report = await StreamReport.start({configuration, stdout}, async (report: StreamReport) => {
        await project.install({cache, report});
      });

      return report.exitCode();
    }
  });
